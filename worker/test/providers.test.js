import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { signJwt } from "../src/jwt.js";
import { createKling, klingAuthHeader } from "../src/providers/kling.js";
import { createElevenLabs } from "../src/providers/elevenlabs.js";
import { env, fakeFetch, noSleep, sampleConfig, tmp } from "./helpers.js";

test("JWT is HS256 with iss, exp and nbf", () => {
  const token = signJwt("ak", "sk", { now: 1000, ttl: 1800 });
  const [h, p, s] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url")), { iss: "ak", exp: 2800, nbf: 995 });
  assert.equal(s, createHmac("sha256", "sk").update(`${h}.${p}`).digest("base64url"));
});

test("Kling auth supports API-key mode and reports missing secrets by name", () => {
  assert.equal(klingAuthHeader({ auth: "apiKey" }, { KLING_API_KEY: "k" }), "Bearer k");
  assert.throws(() => klingAuthHeader({}, {}), /KLING_ACCESS_KEY and KLING_SECRET_KEY/);
});

test("Kling image-to-video: creates a task, polls, downloads", async () => {
  const dir = await tmp();
  const img = path.join(dir, "kf.png");
  await writeFile(img, "PNG");
  const fetch = fakeFetch();
  const kling = createKling(sampleConfig().stages.video, { fetch, env, sleep: noSleep });
  const out = await kling.generateVideo({ prompt: "Bolt waves", imagePath: img, seconds: 10, kind: "final" });
  assert.equal(out.ext, "mp4");
  assert.equal(out.bytes.toString(), "FILE:https://cdn.example/v.mp4");
  const create = fetch.calls[0];
  assert.equal(create.url, "https://api-singapore.klingai.com/v1/videos/image2video");
  assert.equal(create.body.model_name, "vid-model");
  assert.equal(create.body.duration, "10");
  assert.equal(create.body.mode, "pro");
  assert.equal(create.body.image, Buffer.from("PNG").toString("base64"));
  assert.match(create.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(fetch.calls.filter((c) => c.url.endsWith("/vid-1")).length, 2); // processing, then succeed
});

test("Kling surfaces a failed task with its reason", async () => {
  const dir = await tmp();
  const img = path.join(dir, "kf.png");
  await writeFile(img, "PNG");
  const kling = createKling(sampleConfig().stages.video, { fetch: fakeFetch({ failVideo: true }), env, sleep: noSleep });
  await assert.rejects(kling.generateVideo({ prompt: "x", imagePath: img, seconds: 5, kind: "draft" }), /content check/);
});

test("Kling image generation returns downloaded files", async () => {
  const fetch = fakeFetch();
  const kling = createKling(sampleConfig().stages.keyframes, { fetch, env, sleep: noSleep });
  const files = await kling.generateImage({ prompt: "workshop" });
  assert.equal(files.length, 1);
  assert.equal(files[0].ext, "png");
  assert.equal(fetch.calls[0].body.aspect_ratio, "16:9");
});

test("ElevenLabs speaks with the character's voice id", async () => {
  const fetch = fakeFetch();
  const el = createElevenLabs(sampleConfig().stages.voice, { fetch, env });
  const out = await el.generateSpeech({ text: "Hello!", speaker: "Mira" });
  assert.equal(out.bytes.toString(), "MP3DATA");
  assert.match(fetch.calls[0].url, /\/v1\/text-to-speech\/voice-mira\?output_format=mp3_44100_128$/);
  assert.equal(fetch.calls[0].headers["xi-api-key"], "xi");
  await assert.rejects(el.generateSpeech({ text: "beep", speaker: "Bolt" }), /No ElevenLabs voice id for "Bolt"/);
});
