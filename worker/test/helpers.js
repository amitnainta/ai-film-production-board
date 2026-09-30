import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const tmp = () => mkdtemp(path.join(os.tmpdir(), "film-worker-"));

export function sampleBoard(overrides = {}) {
  return {
    settings: {
      budget: 290, draftRate: 6, finalRate: 12, style: "stylized 3D animated film",
      pipeline: { keyframes: "Kling", video: "Kling 3.0", voice: "ElevenLabs" },
      pipelineModes: { keyframes: "automated", video: "automated", voice: "automated" },
    },
    characters: [
      { id: "c1", name: "Mira", look: "girl, red hair, 140 cm" },
      { id: "c2", name: "Bolt", look: "small robot, 45 cm" },
    ],
    shots: [
      { id: "s2", scene: 1, no: 2, duration: 7, characters: "Mira, Bolt", keyframePrompt: "Mira meets Bolt", motionPrompt: "Bolt waves", dialogue: "Hello!", keyframeAsset: "a".repeat(32), renderQueue: { video: "final", voice: true } },
      { id: "s1", scene: 1, no: 1, duration: 5, characters: "Mira", keyframePrompt: "Workshop at dawn", motionPrompt: "slow push-in", renderQueue: { keyframe: true, video: "draft" } },
      { id: "s3", scene: 2, no: 1, duration: 4, characters: "", keyframePrompt: "", motionPrompt: "", renderQueue: { keyframe: true } },
    ],
    takes: [],
    purchases: [{ id: "p1", tool: "Kling 3.0", amount: 80.96, credits: 8000 }],
    ...overrides,
  };
}

export const sampleConfig = () => ({
  budget: { totalUsd: 290, stopAtRemainingUsd: 10 },
  stages: {
    keyframes: { provider: "kling", model: "img-model", usdPerImage: 0.05, options: { variantsPerShot: 1 }, api: { auth: "jwt" } },
    video: { provider: "kling", model: "vid-model", usdPerCredit: 0.01, api: { auth: "jwt" } },
    voice: { provider: "elevenlabs", usdPerLine: 0.02, voices: { Mira: "voice-mira" } },
  },
});

// Fake fetch that answers Kling and ElevenLabs calls and records requests.
export function fakeFetch({ failVideo = false, statuses = ["processing", "succeed"] } = {}) {
  const calls = [];
  let polls = 0;
  const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
  const bytes = (s) => ({ ok: true, status: 200, text: async () => s, arrayBuffer: async () => new TextEncoder().encode(s).buffer });
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("text-to-speech")) return bytes("MP3DATA");
    if (url.startsWith("https://cdn.example/")) return bytes("FILE:" + url);
    if (init.method === "POST") return json({ code: 0, message: "ok", data: { task_id: url.includes("image2video") ? "vid-1" : "img-1", task_status: "submitted" } });
    const status = statuses[Math.min(polls++, statuses.length - 1)];
    if (url.includes("image2video")) {
      if (failVideo) return json({ code: 0, data: { task_status: "failed", task_status_msg: "content check" } });
      return json({ code: 0, data: { task_status: status, task_result: { videos: [{ url: "https://cdn.example/v.mp4" }] } } });
    }
    return json({ code: 0, data: { task_status: status, task_result: { images: [{ url: "https://cdn.example/k.png" }] } } });
  };
  fn.calls = calls;
  return fn;
}

export const env = { KLING_ACCESS_KEY: "ak", KLING_SECRET_KEY: "sk", ELEVENLABS_API_KEY: "xi" };
export const noSleep = async () => {};
