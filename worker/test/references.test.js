import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeBoard } from "../src/board.js";
import { resolveStages } from "../src/config.js";
import { keyframePrompt, referencesFor, selectJobs } from "../src/jobs.js";
import { createKling } from "../src/providers/kling.js";
import { main } from "../src/cli.js";
import { env, fakeFetch, noSleep, sampleConfig, tmp } from "./helpers.js";

const R1 = "1".repeat(32), R2 = "2".repeat(32), R3 = "3".repeat(32);

function refBoard() {
  return normalizeBoard({
    settings: { style: "3D", pipeline: { keyframes: "Kling" }, pipelineModes: { keyframes: "automated" } },
    characters: [
      { id: "a", name: "Arun", look: "boy, 130 cm", refAssets: [R1, "extra"] },
      { id: "t", name: "Tock", look: "brass firefly, 4 cm", refAssets: [R2] },
      { id: "g", name: "Grandpa", look: "in a photo", refAssets: [] },
    ],
    locations: [{ id: "roof", name: "Rooftop", description: "flat roof, water tank", refAssets: [R3] }],
    shots: [{ id: "s1", scene: 4, no: 2, duration: 6, characters: "Arun, Tock, Grandpa", location: "rooftop", keyframePrompt: "Arun sets up the telescope", renderQueue: { keyframe: true } }],
  });
}

test("references: first image per character in the shot, then the location", () => {
  const b = refBoard();
  assert.deepEqual(referencesFor(b, b.shots[0]), [
    { kind: "character", name: "Arun", asset: R1 },
    { kind: "character", name: "Tock", asset: R2 },
    { kind: "location", name: "Rooftop", asset: R3 },
  ]);
});

test("keyframe prompt includes the location description", () => {
  const b = refBoard();
  assert.equal(keyframePrompt(b, b.shots[0], "3D"),
    "Arun sets up the telescope, Arun: boy, 130 cm, Tock: brass firefly, 4 cm, Grandpa: in a photo, setting (Rooftop): flat roof, water tank, 3D");
});

test("Kling multi-reference request sends subjects and scene", async () => {
  const dir = await tmp();
  const refs = [];
  for (const [kind, name, n] of [["character", "Arun", 1], ["character", "Tock", 2], ["location", "Rooftop", 3]]) {
    const p = path.join(dir, `${n}.png`);
    await writeFile(p, `IMG${n}`);
    refs.push({ kind, name, path: p });
  }
  const fetch = fakeFetch();
  const kling = createKling({ ...sampleConfig().stages.keyframes, referenceModel: "ref-model" }, { fetch, env, sleep: noSleep });
  await kling.generateImage({ prompt: "p", references: refs });
  const call = fetch.calls[0];
  assert.equal(call.url, "https://api-singapore.klingai.com/v1/images/multi-image2image");
  assert.equal(call.body.model_name, "ref-model");
  assert.deepEqual(call.body.subject_image_list, [
    { subject_image: Buffer.from("IMG1").toString("base64") },
    { subject_image: Buffer.from("IMG2").toString("base64") },
  ]);
  assert.equal(call.body.scene_image, Buffer.from("IMG3").toString("base64"));
  assert.ok(fetch.calls.some((c) => c.url.endsWith("/v1/images/multi-image2image/img-1")), "polls the same endpoint");
});

test("Kling single-reference mode and no-reference mode use the plain endpoint", async () => {
  const dir = await tmp();
  const p = path.join(dir, "a.png");
  await writeFile(p, "A");
  const fetch = fakeFetch();
  const cfg = { ...sampleConfig().stages.keyframes, options: { referenceMode: "single" } };
  await createKling(cfg, { fetch, env, sleep: noSleep }).generateImage({ prompt: "p", references: [{ kind: "character", name: "Arun", path: p }] });
  assert.equal(fetch.calls[0].url, "https://api-singapore.klingai.com/v1/images/generations");
  assert.equal(fetch.calls[0].body.image, Buffer.from("A").toString("base64"));
  assert.equal(fetch.calls[0].body.image_reference, "subject");
  const f2 = fakeFetch();
  await createKling(sampleConfig().stages.keyframes, { fetch: f2, env, sleep: noSleep }).generateImage({ prompt: "p" });
  assert.equal(f2.calls[0].body.image, undefined);
  assert.equal(f2.calls[0].body.subject_image_list, undefined);
});

test("run passes downloaded references and warns about missing ones", async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, "board.json"), JSON.stringify(refBoard()));
  await writeFile(path.join(dir, "pipeline.json"), JSON.stringify(sampleConfig()));
  const inputs = path.join(dir, "renders", "inputs");
  await mkdir(inputs, { recursive: true });
  await writeFile(path.join(inputs, `${R1}.png`), "ARUN");
  await writeFile(path.join(inputs, `${R3}.jpg`), "ROOF"); // Tock's reference is missing
  const io = { log: () => {}, env, fetch: fakeFetch(), sleep: noSleep, pollIntervalMs: 1 };
  await main(["run", "--confirm", "--board", path.join(dir, "board.json"), "--config", path.join(dir, "pipeline.json"), "--out", path.join(dir, "renders")], io);
  const manifest = JSON.parse(await readFile(path.join(dir, "renders", "results.json"), "utf8"));
  const kf = manifest.results[0];
  assert.equal(kf.status, "succeeded");
  assert.equal(kf.warnings.length, 1);
  assert.match(kf.warnings[0], /Reference for Tock/);
  const body = io.fetch.calls[0].body;
  assert.deepEqual(body.subject_image_list, [{ subject_image: Buffer.from("ARUN").toString("base64") }]);
  assert.equal(body.scene_image, Buffer.from("ROOF").toString("base64"));
});

test("plan lists references per keyframe job", () => {
  const b = refBoard();
  const { jobs } = selectJobs(b, resolveStages(sampleConfig(), b.settings));
  assert.equal(jobs[0].references.length, 3);
});
