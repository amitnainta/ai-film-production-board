// Kling provider: image generation (keyframes) and image-to-video (takes).
//
// Kling's API is task-based: create a task, poll it until `task_status` is
// `succeed` or `failed`, then download the result URL. Endpoints, model ids and
// auth style are all read from config/pipeline.json because Kling has shipped
// more than one API generation; check them against your Kling API console.
import { readFile } from "node:fs/promises";
import { signJwt } from "../jwt.js";
import { ProviderError, download, poll, requestJson } from "./http.js";

const DEFAULT_ENDPOINTS = {
  image: "/v1/images/generations",
  imageToVideo: "/v1/videos/image2video",
};

export function klingAuthHeader(api = {}, env = process.env) {
  if ((api.auth ?? "jwt") === "apiKey") {
    const key = env[api.apiKeyEnv ?? "KLING_API_KEY"];
    if (!key) throw new ProviderError(`Set ${api.apiKeyEnv ?? "KLING_API_KEY"} to use Kling.`);
    return `Bearer ${key}`;
  }
  const ak = env[api.accessKeyEnv ?? "KLING_ACCESS_KEY"];
  const sk = env[api.secretKeyEnv ?? "KLING_SECRET_KEY"];
  if (!ak || !sk) throw new ProviderError(`Set ${api.accessKeyEnv ?? "KLING_ACCESS_KEY"} and ${api.secretKeyEnv ?? "KLING_SECRET_KEY"} to use Kling.`);
  return `Bearer ${signJwt(ak, sk)}`;
}

export function createKling(stageConfig, ctx) {
  const api = stageConfig.api ?? {};
  const base = String(api.baseUrl ?? "https://api-singapore.klingai.com").replace(/\/$/, "");
  const endpoints = { ...DEFAULT_ENDPOINTS, ...(api.endpoints ?? {}) };
  const { fetch, env, sleep, log } = ctx;
  const pollOpts = { intervalMs: ctx.pollIntervalMs ?? 5000, timeoutMs: ctx.timeoutMs ?? 900000, sleep };

  const headers = () => ({ "Content-Type": "application/json", Authorization: klingAuthHeader(api, env) });

  async function createTask(path, body) {
    const res = await requestJson(fetch, base + path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    if (res.code !== 0 || !res.data?.task_id) throw new ProviderError(`Kling rejected the task: ${res.message ?? JSON.stringify(res).slice(0, 200)}`);
    return res.data.task_id;
  }

  async function waitTask(path, taskId, pick) {
    return poll(async () => {
      const res = await requestJson(fetch, `${base}${path}/${encodeURIComponent(taskId)}`, { headers: headers() });
      const d = res.data ?? {};
      if (d.task_status === "failed") throw new ProviderError(`Kling task ${taskId} failed: ${d.task_status_msg ?? "no reason given"}`);
      if (d.task_status === "succeed") {
        const urls = pick(d.task_result ?? {});
        if (!urls.length) throw new ProviderError(`Kling task ${taskId} finished without a result URL.`);
        return urls;
      }
      log?.(`  … ${taskId} ${d.task_status ?? "pending"}`);
      return undefined;
    }, pollOpts);
  }

  return {
    id: "kling",
    async generateImage({ prompt, aspectRatio, n }) {
      const model = stageConfig.model;
      if (!model) throw new ProviderError("Set stages.keyframes.model in pipeline.json (your Kling image model id).");
      const taskId = await createTask(endpoints.image, {
        model_name: model, prompt, n: n ?? stageConfig.options?.variantsPerShot ?? 1,
        aspect_ratio: aspectRatio ?? stageConfig.options?.aspectRatio ?? "16:9",
      });
      const urls = await waitTask(endpoints.image, taskId, (r) => (r.images ?? []).map((i) => i.url).filter(Boolean));
      const files = [];
      for (const url of urls) files.push({ bytes: await download(fetch, url), ext: extFromUrl(url, "png"), meta: { taskId, model, url } });
      return files;
    },
    async generateVideo({ prompt, imagePath, seconds, kind }) {
      const model = stageConfig.model;
      if (!model) throw new ProviderError("Set stages.video.model in pipeline.json (your Kling video model id).");
      const image = (await readFile(imagePath)).toString("base64");
      const opts = stageConfig.options ?? {};
      const taskId = await createTask(endpoints.imageToVideo, {
        model_name: model, image, prompt,
        negative_prompt: opts.negativePrompt ?? undefined,
        duration: String(seconds),
        mode: kind === "final" ? opts.finalMode ?? "pro" : opts.draftMode ?? "std",
      });
      const [url] = await waitTask(endpoints.imageToVideo, taskId, (r) => (r.videos ?? []).map((v) => v.url).filter(Boolean));
      return { bytes: await download(fetch, url), ext: "mp4", meta: { taskId, model, url } };
    },
  };
}

function extFromUrl(url, fallback) {
  const m = /\.([a-z0-9]{3,4})(?:\?|$)/i.exec(url);
  return m ? m[1].toLowerCase() : fallback;
}
