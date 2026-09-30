import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { main } from "../src/cli.js";
import { env, fakeFetch, noSleep, sampleBoard, sampleConfig, tmp } from "./helpers.js";

async function setup(board = sampleBoard(), config = sampleConfig()) {
  const dir = await tmp();
  await writeFile(path.join(dir, "board.json"), JSON.stringify(board));
  await writeFile(path.join(dir, "pipeline.json"), JSON.stringify(config));
  await mkdir(path.join(dir, "renders", "inputs"), { recursive: true });
  await writeFile(path.join(dir, "renders", "inputs", "a".repeat(32) + ".png"), "PNG");
  const args = (cmd, ...more) => [cmd, "--board", path.join(dir, "board.json"), "--config", path.join(dir, "pipeline.json"), "--out", path.join(dir, "renders"), ...more];
  const lines = [];
  const io = { log: (l) => lines.push(l), env, fetch: fakeFetch(), sleep: noSleep, pollIntervalMs: 1 };
  return { dir, args, io, lines };
}

test("run refuses to spend without --confirm", async () => {
  const { args, io, lines } = await setup();
  const res = await main(args("run"), io);
  assert.equal(res.ran, false);
  assert.equal(io.fetch.calls.length, 0);
  assert.ok(lines.some((l) => /--confirm/.test(l)));
});

test("run --confirm renders every job and writes a manifest", async () => {
  const { dir, args, io } = await setup();
  const res = await main(args("run", "--confirm"), io);
  assert.equal(res.ran, true);
  const manifest = JSON.parse(await readFile(path.join(dir, "renders", "results.json"), "utf8"));
  assert.deepEqual(manifest.results.map((r) => [r.jobId, r.status]), [
    ["SC01-SH01-keyframe", "succeeded"],
    ["SC01-SH01-video-draft", "succeeded"],
    ["SC01-SH02-video-final", "succeeded"],
    ["SC01-SH02-voice", "succeeded"],
  ]);
  const draft = manifest.results[1];
  assert.equal(draft.credits, 30);
  assert.equal(draft.files[0].contentType, "video/mp4");
  // The draft animated the keyframe rendered earlier in the same run.
  const kfBytes = await readFile(manifest.results[0].files[0].path);
  const createCall = io.fetch.calls.find((c) => c.method === "POST" && c.url.includes("image2video"));
  assert.equal(createCall.body.image, kfBytes.toString("base64"));
});

test("a missing keyframe input fails only that job", async () => {
  const board = sampleBoard();
  board.shots[0].keyframeAsset = "b".repeat(32);
  const { dir, args, io } = await setup(board);
  await main(args("run", "--confirm", "--only", "SC01-SH02"), io);
  const manifest = JSON.parse(await readFile(path.join(dir, "renders", "results.json"), "utf8"));
  const video = manifest.results.find((r) => r.jobId === "SC01-SH02-video-final");
  assert.equal(video.status, "failed");
  assert.match(video.error, /isn't in .*inputs/);
  assert.equal(manifest.results.find((r) => r.jobId === "SC01-SH02-voice").status, "succeeded");
});

test("mock provider runs without --confirm and marks outputs as mock", async () => {
  const board = sampleBoard();
  board.settings.pipeline = { keyframes: "Mock (test)", video: "Mock (test)", voice: "Mock (test)" };
  const { dir, args, io } = await setup(board);
  const res = await main(args("run"), io);
  assert.equal(res.ran, true);
  assert.equal(io.fetch.calls.length, 0);
  const manifest = JSON.parse(await readFile(path.join(dir, "renders", "results.json"), "utf8"));
  assert.ok(manifest.results.every((r) => r.status === "succeeded" && r.files.every((f) => f.mock)));
});

test("doctor lists missing secrets and placeholder voices", async () => {
  const { args, io, lines } = await setup(sampleBoard(), { ...sampleConfig(), stages: { ...sampleConfig().stages, voice: { provider: "elevenlabs", usdPerLine: 0.02, voices: { Bolt: "<voice id>" } } } });
  const res = await main(args("doctor"), { ...io, env: {} });
  assert.ok(res.problems.some((p) => p.includes("KLING_ACCESS_KEY")));
  assert.ok(res.problems.some((p) => p.includes("ELEVENLABS_API_KEY")));
  assert.ok(res.problems.some((p) => p.includes("placeholder")));
  assert.ok(lines.some((l) => /problem/.test(l)));
});

test("reads a database dump directory as well as an export file", async () => {
  const { dir, io } = await setup();
  const dump = path.join(dir, "dump");
  for (const [col, docs] of Object.entries({ shots: sampleBoard().shots, characters: sampleBoard().characters, settings: [{ id: "film", ...sampleBoard().settings }] })) {
    await mkdir(path.join(dump, col), { recursive: true });
    for (const d of docs) { const { id, ...data } = d; await writeFile(path.join(dump, col, `${id}.json`), JSON.stringify({ id, data, version: 1 })); }
  }
  const res = await main(["plan", "--board", dump, "--config", path.join(dir, "pipeline.json"), "--out", path.join(dir, "renders")], io);
  assert.equal(res.allowed.length, 4);
});
