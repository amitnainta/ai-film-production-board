// Turns board state into render jobs. A shot asks for work through its
// `renderQueue` field, set from the shot editor:
//   { keyframe: true, video: "draft" | "final", voice: true }
import { num, slug, sortShots } from "./board.js";

export function castFor(board, names) {
  const wanted = String(names ?? "").split(/[,&]/).map((n) => n.trim().toLowerCase()).filter(Boolean);
  return board.characters.filter((c) => wanted.includes(String(c.name ?? "").toLowerCase()));
}

export function keyframePrompt(board, shot, style) {
  const looks = castFor(board, shot.characters).filter((c) => c.look).map((c) => `${c.name}: ${c.look}`);
  return [shot.keyframePrompt, ...looks, style].map((s) => String(s ?? "").trim()).filter(Boolean).join(", ");
}

// Kling renders 5 s or 10 s clips; longer shots are trimmed in the edit.
export function videoSeconds(shot) {
  return num(shot.duration, 5) > 5 ? 10 : 5;
}

export function selectJobs(board, stages) {
  const style = board.settings.style ?? "";
  const jobs = [];
  const skipped = [];
  for (const shot of sortShots(board.shots)) {
    const q = shot.renderQueue ?? {};
    const name = slug(shot);
    const auto = (stage) => stages[stage]?.mode === "automated";
    const why = (stage, reason) => skipped.push({ shotId: shot.id, shot: name, stage, reason });

    if (q.keyframe) {
      if (!auto("keyframes")) why("keyframes", "Keyframes stage is manual");
      else if (stages.keyframes.blocked) why("keyframes", stages.keyframes.blocked);
      else if (!shot.keyframePrompt) why("keyframes", "Shot has no keyframe prompt");
      else jobs.push({ id: `${name}-keyframe`, shotId: shot.id, shot: name, stage: "keyframes", provider: stages.keyframes.provider, prompt: keyframePrompt(board, shot, style) });
    }

    if (q.video) {
      const kind = q.video === "final" ? "final" : "draft";
      if (!auto("video")) why("video", "Video stage is manual");
      else if (stages.video.blocked) why("video", stages.video.blocked);
      else if (!shot.keyframeAsset && !q.keyframe) why("video", "Shot has no keyframe to animate");
      else if (!shot.motionPrompt) why("video", "Shot has no motion prompt");
      else {
        const seconds = videoSeconds(shot);
        const rate = kind === "final" ? num(board.settings.finalRate, 12) : num(board.settings.draftRate, 6);
        jobs.push({
          id: `${name}-video-${kind}`, shotId: shot.id, shot: name, stage: "video", provider: stages.video.provider, kind,
          prompt: shot.motionPrompt, keyframeAsset: shot.keyframeAsset ?? null, waitsFor: shot.keyframeAsset ? null : `${name}-keyframe`,
          seconds, credits: Math.round(seconds * rate),
        });
      }
    }

    if (q.voice) {
      if (!auto("voice")) why("voice", "Voice stage is manual");
      else if (stages.voice.blocked) why("voice", stages.voice.blocked);
      else if (!shot.dialogue) why("voice", "Shot has no dialogue");
      else {
        const speaker = castFor(board, shot.characters)[0]?.name ?? null;
        jobs.push({ id: `${name}-voice`, shotId: shot.id, shot: name, stage: "voice", provider: stages.voice.provider, text: shot.dialogue, speaker });
      }
    }
  }
  return { jobs, skipped };
}
