// Stage 3: assembly. Builds a timeline from the board (selected take, else
// keyframe still, else slate card for every shot, in order), then writes:
//   timeline.json   the timeline itself
//   captions.srt    dialogue captions
//   timeline.edl    CMX 3600 video edit list
//   timeline.fcpxml FCPXML 1.9 with video and dialogue, for DaVinci Resolve
//   assemble.sh     the ffmpeg commands, runnable by hand
//   rough-cut.mp4   when ffmpeg is available
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { num, slug, sortShots } from "./board.js";

const run = promisify(execFile);

export const DEFAULTS = { fps: 24, width: 1920, height: 1080, slateColor: "0x1a202b", musicVolumeDb: -14 };

// ---------- Timeline ----------

export async function buildTimeline(board, { inputsDir, root, fps = DEFAULTS.fps }) {
  const files = await listDir(inputsDir);
  const byAsset = (id) => {
    if (!id) return null;
    const f = files.find((n) => n === id || n.startsWith(id + "."));
    return f ? path.join(inputsDir, f) : null;
  };
  const segments = [];
  const warnings = [];
  let frame = 0;
  for (const shot of sortShots(board.shots)) {
    const name = slug(shot);
    const frames = Math.max(1, Math.round(num(shot.duration, 5) * fps));
    const take = shot.selectedTake ? board.takes.find((t) => t.id === shot.selectedTake) : null;
    let video = { type: "slate", path: null };
    const takePath = take ? byAsset(take.asset) : null;
    const stillPath = byAsset(shot.keyframeAsset);
    if (takePath) video = { type: "take", path: takePath };
    else if (stillPath) video = { type: "still", path: stillPath };
    if (take && !takePath) warnings.push(`${name}: selected take ${take.asset} isn't in ${inputsDir}; using ${video.type}.`);
    if (!take && shot.keyframeAsset && !stillPath) warnings.push(`${name}: keyframe ${shot.keyframeAsset} isn't in ${inputsDir}; using a slate.`);

    let dialoguePath = null;
    if (shot.dialogueFile) {
      const p = path.isAbsolute(shot.dialogueFile) ? shot.dialogueFile : path.join(root, shot.dialogueFile);
      if (existsSync(p) && !p.endsWith(".mock.txt")) dialoguePath = p;
      else warnings.push(`${name}: dialogue file ${shot.dialogueFile} not found.`);
    }
    segments.push({
      shot: name, shotId: shot.id, startFrame: frame, frames,
      video, dialoguePath, dialogue: String(shot.dialogue ?? ""), action: String(shot.action ?? ""),
    });
    frame += frames;
  }
  return { fps, totalFrames: frame, segments, warnings };
}

async function listDir(dir) {
  try { return (await readdir(dir)).sort(); } catch { return []; }
}

// ---------- Text formats ----------

export function timecode(frames, fps, offsetHours = 0) {
  const total = frames + offsetHours * 3600 * fps;
  const f = total % fps;
  const s = Math.floor(total / fps);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

function srtTime(frames, fps) {
  const ms = Math.round((frames / fps) * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function toSrt(tl) {
  let n = 0;
  return tl.segments.filter((s) => s.dialogue.trim()).map((s) =>
    `${++n}\n${srtTime(s.startFrame, tl.fps)} --> ${srtTime(s.startFrame + s.frames, tl.fps)}\n${s.dialogue.trim()}\n`).join("\n");
}

export function toEdl(tl, title) {
  const lines = [`TITLE: ${title.replace(/[\r\n]/g, " ").slice(0, 70)}`, "FCM: NON-DROP FRAME", ""];
  let n = 0;
  for (const s of tl.segments) {
    if (!s.video.path) continue; // slates stay as gaps
    n++;
    const src = [timecode(0, tl.fps), timecode(s.frames, tl.fps)];
    const rec = [timecode(s.startFrame, tl.fps, 1), timecode(s.startFrame + s.frames, tl.fps, 1)];
    lines.push(`${String(n).padStart(3, "0")}  AX       V     C        ${src[0]} ${src[1]} ${rec[0]} ${rec[1]}`);
    lines.push(`* FROM CLIP NAME: ${path.basename(s.video.path)}`);
    lines.push(`* COMMENT: ${s.shot}`, "");
  }
  return lines.join("\n");
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fileUrl = (p) => "file://" + path.resolve(p).split(path.sep).map(encodeURIComponent).join("/");

export function toFcpxml(tl, { title, width = DEFAULTS.width, height = DEFAULTS.height, sourceFrames = {} }) {
  const t = (frames) => (frames === 0 ? "0s" : `${frames}/${tl.fps}s`);
  const assets = new Map();
  const assetFor = (p, kind) => {
    if (!assets.has(p)) {
      const id = `r${assets.size + 2}`;
      const dur = sourceFrames[p] ?? Math.max(...tl.segments.filter((s) => s.video.path === p || s.dialoguePath === p).map((s) => s.frames));
      assets.set(p, { id, p, kind, dur });
    }
    return assets.get(p).id;
  };
  const spine = tl.segments.map((s) => {
    const offset = t(s.startFrame);
    const dur = t(s.frames);
    const start = s.video.path ? "0s" : "3600s";
    const ref = s.video.path ? assetFor(s.video.path, s.video.type) : null;
    const audio = s.dialoguePath
      ? `\n          <asset-clip ref="${assetFor(s.dialoguePath, "audio")}" lane="-1" offset="${start}" name="${xml(s.shot)} dialogue" duration="${t(Math.min(s.frames, sourceFrames[s.dialoguePath] ?? s.frames))}" start="0s" role="dialogue"/>\n        `
      : "";
    if (!s.video.path) return `        <gap name="${xml(s.shot)} slate" offset="${offset}" duration="${dur}" start="${start}">${audio}</gap>`;
    const src = s.video.type === "take" ? sourceFrames[s.video.path] : null;
    const clipFrames = src && src < s.frames ? src : s.frames;
    const clip = `        <asset-clip ref="${ref}" offset="${offset}" name="${xml(s.shot)}" duration="${t(clipFrames)}" start="0s" format="r1" tcFormat="NDF">${audio}</asset-clip>`;
    if (clipFrames === s.frames) return clip;
    // The take is shorter than the planned shot: hold the rest as a gap (ffmpeg freezes the last frame instead).
    return `${clip}\n        <gap name="${xml(s.shot)} hold" offset="${t(s.startFrame + clipFrames)}" duration="${t(s.frames - clipFrames)}" start="3600s"/>`;
  }).join("\n");
  const res = [...assets.values()].map((a) => {
    const video = a.kind !== "audio";
    return `    <asset id="${a.id}" name="${xml(path.basename(a.p))}" start="0s" duration="${t(a.dur)}" hasVideo="${video ? 1 : 0}" hasAudio="${a.kind === "audio" ? 1 : 0}"${video ? ' format="r1"' : ' audioSources="1" audioChannels="1" audioRate="44100"'}>\n      <media-rep kind="original-media" src="${xml(fileUrl(a.p))}"/>\n    </asset>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${height}p${tl.fps}" frameDuration="1/${tl.fps}s" width="${width}" height="${height}"/>
${res}
  </resources>
  <library>
    <event name="${xml(title)}">
      <project name="${xml(title)} rough cut">
        <sequence format="r1" duration="${t(tl.totalFrames)}" tcStart="3600s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

// ---------- ffmpeg ----------

export function ffmpegPlan(tl, { workDir, outFile, width = DEFAULTS.width, height = DEFAULTS.height, slateColor = DEFAULTS.slateColor, music = null, musicVolumeDb = DEFAULTS.musicVolumeDb }) {
  const fps = tl.fps;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;
  const enc = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(fps)];
  const steps = [];
  const segFiles = [];
  tl.segments.forEach((s, i) => {
    const secs = (s.frames / fps).toFixed(3);
    const seg = path.join(workDir, `seg-${String(i + 1).padStart(3, "0")}.mp4`);
    segFiles.push(seg);
    let input;
    let filter = vf;
    if (s.video.type === "take") { input = ["-i", s.video.path]; filter = `${vf},tpad=stop_mode=clone:stop_duration=${secs}`; }
    else if (s.video.type === "still") input = ["-loop", "1", "-framerate", String(fps), "-i", s.video.path];
    else input = ["-f", "lavfi", "-i", `color=c=${slateColor}:s=${width}x${height}:r=${fps}`];
    steps.push({ label: `${s.shot} (${s.video.type})`, args: ["-y", "-hide_banner", "-loglevel", "error", ...input, "-vf", filter, "-t", secs, ...enc, seg] });
  });

  const list = path.join(workDir, "segments.txt");
  const listBody = segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  const video = path.join(workDir, "video.mp4");
  steps.push({ label: "join video", args: ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video] });

  const total = (tl.totalFrames / fps).toFixed(3);
  const inputs = ["-i", video];
  const parts = [];
  let n = 1;
  for (const s of tl.segments) {
    if (!s.dialoguePath) continue;
    inputs.push("-i", s.dialoguePath);
    const ms = Math.round((s.startFrame / fps) * 1000);
    parts.push(`[${n}:a]aformat=channel_layouts=stereo:sample_rates=48000,atrim=0:${(s.frames / fps).toFixed(3)},adelay=${ms}|${ms}[a${n}]`);
    n++;
  }
  if (music) {
    inputs.push("-stream_loop", "-1", "-i", music);
    parts.push(`[${n}:a]aformat=channel_layouts=stereo:sample_rates=48000,volume=${musicVolumeDb}dB[a${n}]`);
    n++;
  }
  let map;
  if (n === 1) {
    inputs.push("-f", "lavfi", "-t", total, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    map = ["-map", "0:v", "-map", "1:a"];
  } else {
    const labels = Array.from({ length: n - 1 }, (_, i) => `[a${i + 1}]`).join("");
    parts.push(`${labels}amix=inputs=${n - 1}:normalize=0:duration=longest,apad,atrim=0:${total}[mix]`);
    map = ["-filter_complex", parts.join(";"), "-map", "0:v", "-map", "[mix]"];
  }
  steps.push({ label: "mix audio and finish", args: ["-y", "-hide_banner", "-loglevel", "error", ...inputs, ...map, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", total, "-movflags", "+faststart", outFile] });
  return { steps, list, listBody };
}

const shq = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);

export function toShell(plan, ffmpeg = "ffmpeg") {
  return [
    "#!/bin/sh", "# Rough cut assembly, generated by film-worker. Run from anywhere.", "set -e",
    `cat > ${shq(plan.list)} <<'EOF'`, plan.listBody.trimEnd(), "EOF",
    ...plan.steps.flatMap((s) => [`# ${s.label}`, [shq(ffmpeg), ...s.args.map(shq)].join(" ")]),
  ].join("\n") + "\n";
}

export function findFfmpeg(explicit, env = process.env) {
  const candidates = [explicit, env.FFMPEG_PATH].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  for (const dir of String(env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, "ffmpeg");
    if (dir && existsSync(p)) return p;
  }
  return null;
}

// Media length in frames, read from ffmpeg's banner (no ffprobe needed).
export async function probeFrames(ffmpeg, file, fps) {
  try {
    await run(ffmpeg, ["-hide_banner", "-i", file]);
  } catch (e) {
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(e.stderr ?? ""));
    if (m) return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * fps);
  }
  return null;
}

// ---------- Orchestration ----------

export async function assemble(board, opts) {
  const { outDir, inputsDir, root, title, log = () => {}, render = true } = opts;
  const settings = { ...DEFAULTS, ...(opts.assembly ?? {}) };
  const tl = await buildTimeline(board, { inputsDir, root, fps: settings.fps });
  await mkdir(outDir, { recursive: true });
  const workDir = path.join(outDir, "work");
  await mkdir(workDir, { recursive: true });

  const ffmpeg = findFfmpeg(opts.ffmpeg, opts.env);
  const sourceFrames = {};
  if (ffmpeg) {
    for (const s of tl.segments) for (const p of [s.video.type === "take" ? s.video.path : null, s.dialoguePath]) {
      if (p && !(p in sourceFrames)) sourceFrames[p] = await probeFrames(ffmpeg, p, tl.fps) ?? undefined;
    }
  }

  const outFile = path.join(outDir, "rough-cut.mp4");
  const plan = ffmpegPlan(tl, { workDir, outFile, ...settings, music: opts.music ?? null });
  const files = {
    timeline: path.join(outDir, "timeline.json"),
    srt: path.join(outDir, "captions.srt"),
    edl: path.join(outDir, "timeline.edl"),
    fcpxml: path.join(outDir, "timeline.fcpxml"),
    script: path.join(outDir, "assemble.sh"),
  };
  await writeFile(files.timeline, JSON.stringify(tl, null, 2));
  await writeFile(files.srt, toSrt(tl));
  await writeFile(files.edl, toEdl(tl, title));
  await writeFile(files.fcpxml, toFcpxml(tl, { title, width: settings.width, height: settings.height, sourceFrames }));
  await writeFile(files.script, toShell(plan, ffmpeg ?? "ffmpeg"));
  await chmod(files.script, 0o755);

  const counts = tl.segments.reduce((a, s) => ({ ...a, [s.video.type]: (a[s.video.type] ?? 0) + 1 }), {});
  log(`Timeline: ${tl.segments.length} shots, ${timecode(tl.totalFrames, tl.fps).slice(0, 8)} at ${tl.fps} fps · ${counts.take ?? 0} takes, ${counts.still ?? 0} stills, ${counts.slate ?? 0} slates`);
  for (const w of tl.warnings) log(`  ! ${w}`);

  let rendered = false;
  if (render && !ffmpeg) log("ffmpeg not found: wrote the edit files and assemble.sh but no video. Set FFMPEG_PATH or pass --ffmpeg.");
  if (render && ffmpeg && tl.segments.length) {
    await writeFile(plan.list, plan.listBody);
    for (const step of plan.steps) {
      log(`  ffmpeg: ${step.label}`);
      await run(ffmpeg, step.args, { maxBuffer: 16 * 1024 * 1024 });
    }
    rendered = true;
    log(`Rough cut: ${outFile}`);
  }
  return { timeline: tl, files: { ...files, video: rendered ? outFile : null }, ffmpeg };
}
