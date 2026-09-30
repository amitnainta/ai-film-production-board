import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeBoard } from "../src/board.js";
import { assemble, buildTimeline, ffmpegPlan, findFfmpeg, probeFrames, timecode, toEdl, toFcpxml, toSrt } from "../src/assemble.js";
import { tmp } from "./helpers.js";

const run = promisify(execFile);
const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);

function cutBoard() {
  return normalizeBoard({
    settings: { title: "Mira & Bolt" },
    shots: [
      { id: "s3", scene: 2, no: 1, duration: 2, action: "Rooftop walk", dialogue: "" },
      { id: "s1", scene: 1, no: 1, duration: 2, selectedTake: "t1", keyframeAsset: B, dialogue: "You're awake?", dialogueFile: "d/s1.wav" },
      { id: "s2", scene: 1, no: 2, duration: 1.5, keyframeAsset: C, dialogue: "Beep." },
    ],
    takes: [{ id: "t1", shotId: "s1", asset: A, kind: "draft" }],
  });
}

async function inputs(dir, { take = true, still = true } = {}) {
  const inp = path.join(dir, "inputs");
  await mkdir(inp, { recursive: true });
  if (take) await writeFile(path.join(inp, `${A}.mp4`), "x");
  if (still) await writeFile(path.join(inp, `${C}.png`), "x");
  await mkdir(path.join(dir, "d"), { recursive: true });
  await writeFile(path.join(dir, "d", "s1.wav"), "x");
  return inp;
}

test("timeline uses the selected take, then the keyframe, then a slate, in shot order", async () => {
  const dir = await tmp();
  const tl = await buildTimeline(cutBoard(), { inputsDir: await inputs(dir), root: dir, fps: 24 });
  assert.deepEqual(tl.segments.map((s) => [s.shot, s.video.type, s.startFrame, s.frames]), [
    ["SC01-SH01", "take", 0, 48],
    ["SC01-SH02", "still", 48, 36],
    ["SC02-SH01", "slate", 84, 48],
  ]);
  assert.equal(tl.totalFrames, 132);
  assert.equal(tl.segments[0].dialoguePath, path.join(dir, "d", "s1.wav"));
  assert.deepEqual(tl.warnings, []);
});

test("missing media falls back and says why", async () => {
  const dir = await tmp();
  const tl = await buildTimeline(cutBoard(), { inputsDir: await inputs(dir, { take: false, still: false }), root: dir, fps: 24 });
  assert.deepEqual(tl.segments.map((s) => s.video.type), ["slate", "slate", "slate"]);
  assert.equal(tl.warnings.length, 2);
  assert.match(tl.warnings[0], /selected take .* isn't in/);
});

test("timecodes, captions and EDL", async () => {
  const dir = await tmp();
  const tl = await buildTimeline(cutBoard(), { inputsDir: await inputs(dir), root: dir, fps: 24 });
  assert.equal(timecode(0, 24, 1), "01:00:00:00");
  assert.equal(timecode(24 * 61 + 5, 24), "00:01:01:05");
  assert.equal(toSrt(tl), "1\n00:00:00,000 --> 00:00:02,000\nYou're awake?\n\n2\n00:00:02,000 --> 00:00:03,500\nBeep.\n");
  const edl = toEdl(tl, "Mira & Bolt");
  assert.match(edl, /^TITLE: Mira & Bolt\nFCM: NON-DROP FRAME/);
  assert.match(edl, /001  AX       V     C        00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00\n\* FROM CLIP NAME: a{32}\.mp4/);
  assert.match(edl, /002  AX       V     C        00:00:00:00 00:00:01:12 01:00:02:00 01:00:03:12/);
  assert.doesNotMatch(edl, /003/); // slate stays a gap
});

test("FCPXML lays clips end to end with dialogue as a connected clip", async () => {
  const dir = await tmp();
  const tl = await buildTimeline(cutBoard(), { inputsDir: await inputs(dir), root: dir, fps: 24 });
  const x = toFcpxml(tl, { title: "Mira & Bolt", sourceFrames: {} });
  assert.match(x, /<fcpxml version="1.9">/);
  assert.match(x, /<event name="Mira &amp; Bolt">/);
  assert.match(x, /<asset-clip ref="r2" offset="0s" name="SC01-SH01" duration="48\/24s"/);
  assert.match(x, /<asset-clip ref="r3" lane="-1" offset="0s" name="SC01-SH01 dialogue"/);
  assert.match(x, /<asset-clip ref="r4" offset="48\/24s" name="SC01-SH02" duration="36\/24s"/);
  assert.match(x, /<gap name="SC02-SH01 slate" offset="84\/24s" duration="48\/24s"/);
  assert.match(x, /<sequence format="r1" duration="132\/24s"/);
  // A take shorter than its slot is followed by a hold gap.
  const short = toFcpxml(tl, { title: "t", sourceFrames: { [tl.segments[0].video.path]: 30 } });
  assert.match(short, /name="SC01-SH01" duration="30\/24s"[\s\S]*<gap name="SC01-SH01 hold" offset="30\/24s" duration="18\/24s"/);
});

test("ffmpeg plan: one step per shot, join, then audio mix", async () => {
  const dir = await tmp();
  const tl = await buildTimeline(cutBoard(), { inputsDir: await inputs(dir), root: dir, fps: 24 });
  const plan = ffmpegPlan(tl, { workDir: "/w", outFile: "/w/out.mp4", music: "/m.mp3" });
  assert.equal(plan.steps.length, 5);
  assert.ok(plan.steps[0].args.includes("tpad=stop_mode=clone:stop_duration=2.000") || plan.steps[0].args.some((a) => a.includes("tpad=stop_mode=clone:stop_duration=2.000")));
  assert.ok(plan.steps[1].args.includes("-loop"));
  assert.ok(plan.steps[2].args.some((a) => a.startsWith("color=c=0x1a202b")));
  const mix = plan.steps[4].args.join(" ");
  assert.match(mix, /adelay=0\|0/);
  assert.match(mix, /-stream_loop -1 -i \/m\.mp3/);
  assert.match(mix, /volume=-14dB/);
  assert.match(mix, /amix=inputs=2/);
});

const ffmpeg = findFfmpeg();
test("renders a real rough cut with ffmpeg", { skip: !ffmpeg && "ffmpeg not found (set FFMPEG_PATH)" }, async () => {
  const dir = await tmp();
  const inp = path.join(dir, "inputs");
  await mkdir(inp, { recursive: true });
  await mkdir(path.join(dir, "d"), { recursive: true });
  const ff = (args) => run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args]);
  await ff(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=12", "-t", "1", "-pix_fmt", "yuv420p", path.join(inp, `${A}.mp4`)]); // shorter than its 2 s slot
  await ff(["-f", "lavfi", "-i", "color=c=orange:s=200x200", "-frames:v", "1", path.join(inp, `${C}.png`)]);
  await ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", path.join(dir, "d", "s1.wav")]);
  const lines = [];
  const res = await assemble(cutBoard(), {
    outDir: path.join(dir, "cut"), inputsDir: inp, root: dir, title: "Test", ffmpeg,
    assembly: { fps: 12, width: 320, height: 180 }, log: (l) => lines.push(l),
  });
  assert.ok(res.files.video);
  assert.equal(await probeFrames(ffmpeg, res.files.video, 12), 66); // 2 + 1.5 + 2 s at 12 fps
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-i", res.files.video]).catch((e) => e);
  assert.match(stderr, /Video: h264.*320x180/);
  assert.match(stderr, /Audio: aac/);
  const script = await readFile(res.files.script, "utf8");
  assert.match(script, /^#!\/bin\/sh/);
});
