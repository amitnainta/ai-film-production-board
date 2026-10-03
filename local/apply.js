// Writes a render run's results into the local board: the local version of
// render-sync step 5 (.claude/skills/render-sync/SKILL.md).
import path from "node:path";
import * as store from "./store.js";

const QUEUE_KEY = { keyframes: "keyframe", video: "video", voice: "voice" };

export async function applyResults(manifest, skipped = [], { log = () => {} } = {}) {
  const shots = new Map();
  const shot = async (id) => {
    if (!shots.has(id)) shots.set(id, { doc: await store.getDoc("shots", id), failed: false, touched: false });
    return shots.get(id);
  };
  const summary = { keyframes: 0, takes: 0, voice: 0, failed: 0, skipped: 0 };

  for (const r of manifest?.results ?? []) {
    const s = await shot(r.shotId);
    if (!s.doc) { log(`  ! ${r.shot}: shot no longer on the board; result left in renders/`); continue; }
    const d = s.doc; s.touched = true;
    if (r.status !== "succeeded") {
      d.renderError = r.error || "Render failed"; s.failed = true; summary.failed++;
      continue;
    }
    const real = (r.files ?? []).filter((f) => !f.mock); // mock output is rehearsal only
    const first = real[0];
    if (r.stage === "keyframes" && first) {
      d.keyframeAsset = await store.importAssetFile(first.path);
      if ((d.status || "script") === "script") d.status = "keyframe";
      if (real.length > 1) log(`  ${r.shot}: ${real.length - 1} more keyframe variant(s) in ${path.dirname(first.path)}`);
      summary.keyframes++;
    } else if (r.stage === "video" && first) {
      const asset = await store.importAssetFile(first.path);
      const takeId = store.newId();
      await store.setDoc("takes", takeId, {
        shotId: r.shotId, asset, kind: r.kind || "draft", credits: Number(r.credits) || 0, createdAt: new Date().toISOString(),
        fileName: path.basename(first.path), provider: r.provider, taskId: first.meta?.taskId ?? null,
      });
      d.takes = (Number(d.takes) || 0) + 1;
      d.credits = (Number(d.credits) || 0) + (Number(r.credits) || 0);
      if (!d.selectedTake) d.selectedTake = takeId;
      if (["script", "keyframe"].includes(d.status || "script")) d.status = "animating";
      summary.takes++;
    } else if (r.stage === "voice" && first) {
      d.dialogueFile = path.relative(store.ROOT, first.path).split(path.sep).join("/");
      summary.voice++;
    }
    const q = { ...(d.renderQueue || {}) };
    delete q[QUEUE_KEY[r.stage]];
    d.renderQueue = Object.keys(q).length ? q : null;
  }

  for (const k of skipped) {
    const s = await shot(k.shotId);
    if (!s.doc || s.failed) continue;
    s.doc.renderError = `Skipped: ${k.reason}`; s.failed = true; s.touched = true; summary.skipped++;
  }

  for (const [id, s] of shots) {
    if (!s.doc || !s.touched) continue;
    if (!s.failed) s.doc.renderError = null;
    await store.setDoc("shots", id, s.doc);
  }
  return summary;
}
