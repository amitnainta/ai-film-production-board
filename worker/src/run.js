// Executes render jobs and writes a results manifest that the board sync step
// (see .claude/skills/render-sync) turns into assets, takes and cost records.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProvider } from "./providers/index.js";

const STAGE_ORDER = { keyframes: 0, video: 1, voice: 2 };
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", "mock.txt": "text/plain" };

export async function runJobs(jobs, stages, { outDir, inputsDir, ctx, runId = new Date().toISOString().replace(/[:.]/g, "-") }) {
  const ordered = [...jobs].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);
  const providers = new Map();
  const done = new Map();
  const results = [];
  const log = ctx.log ?? (() => {});

  const providerFor = (job) => {
    const key = `${job.stage}:${job.provider}`;
    if (!providers.has(key)) providers.set(key, createProvider(job.provider, stages[job.stage] ?? {}, ctx));
    return providers.get(key);
  };

  for (const job of ordered) {
    log(`▶ ${job.id} (${job.provider})`);
    const base = { jobId: job.id, shotId: job.shotId, shot: job.shot, stage: job.stage, kind: job.kind ?? null, provider: job.provider, credits: job.credits ?? 0, estUsd: job.estUsd ?? 0 };
    try {
      const provider = providerFor(job);
      const files = await withRetry(() => execute(job, provider), log);
      const saved = [];
      for (const [i, f] of files.entries()) {
        const dir = path.join(outDir, job.shot);
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, `${job.id}${files.length > 1 ? `-${i + 1}` : ""}.${f.ext}`);
        await writeFile(file, f.bytes);
        saved.push({ path: file, contentType: TYPES[f.ext] ?? "application/octet-stream", mock: !!f.meta?.mock, meta: f.meta ?? {} });
      }
      done.set(job.id, saved);
      results.push({ ...base, status: "succeeded", files: saved });
      log(`  ✓ ${saved.map((s) => s.path).join(", ")}`);
    } catch (e) {
      results.push({ ...base, status: "failed", files: [], error: e.message });
      log(`  ✗ ${e.message}`);
    }
  }

  async function execute(job, provider) {
    if (job.stage === "keyframes") return provider.generateImage({ prompt: job.prompt });
    if (job.stage === "video") {
      const imagePath = await keyframePath(job);
      return [await provider.generateVideo({ prompt: job.prompt, imagePath, seconds: job.seconds, kind: job.kind })];
    }
    if (job.stage === "voice") return [await provider.generateSpeech({ text: job.text, speaker: job.speaker })];
    throw new Error(`Unknown stage ${job.stage}`);
  }

  async function keyframePath(job) {
    if (job.waitsFor) {
      const kf = done.get(job.waitsFor);
      if (!kf?.length) throw new Error(`Keyframe job ${job.waitsFor} didn't produce an image, so there is nothing to animate.`);
      if (kf[0].mock && job.provider !== "mock") throw new Error("The keyframe came from the mock provider; a real video provider needs a real keyframe.");
      return kf[0].path;
    }
    const found = await findInput(inputsDir, job.keyframeAsset);
    if (!found) throw new Error(`Keyframe asset ${job.keyframeAsset} isn't in ${inputsDir}. Download it from the board first (render-sync step 2).`);
    return found;
  }

  const manifest = { runId, finishedAt: new Date().toISOString(), results };
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `results-${runId}.json`), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(outDir, "results.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function withRetry(fn, log) {
  try { return await fn(); }
  catch (e) {
    if (!e.retryable) throw e;
    log(`  ↻ retrying once: ${e.message}`);
    return fn();
  }
}

async function findInput(dir, assetId) {
  if (!assetId) return null;
  let files;
  try { files = await readdir(dir); } catch { return null; }
  const hit = files.find((f) => f === assetId || f.startsWith(assetId + "."));
  return hit ? path.join(dir, hit) : null;
}
