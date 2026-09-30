import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStages } from "../src/config.js";
import { keyframePrompt, selectJobs, videoSeconds } from "../src/jobs.js";
import { applyBudget, estimateUsd } from "../src/budget.js";
import { normalizeBoard } from "../src/board.js";
import { sampleBoard, sampleConfig } from "./helpers.js";

test("board choices override config: tool and mode per stage", () => {
  const stages = resolveStages(sampleConfig(), { pipeline: { video: "Mock (test)" }, pipelineModes: { video: "automated" } });
  assert.equal(stages.video.provider, "mock");
  assert.equal(stages.video.mode, "automated");
  assert.equal(stages.keyframes.mode, "manual");
});

test("an automated stage whose board tool has no provider is blocked", () => {
  const stages = resolveStages(sampleConfig(), { pipeline: { keyframes: "Midjourney" }, pipelineModes: { keyframes: "automated" } });
  assert.equal(stages.keyframes.provider, null);
  assert.match(stages.keyframes.blocked, /Midjourney/);
});

test("selects queued work in shot order and explains what it skips", () => {
  const board = normalizeBoard(sampleBoard());
  const { jobs, skipped } = selectJobs(board, resolveStages(sampleConfig(), board.settings));
  assert.deepEqual(jobs.map((j) => j.id), ["SC01-SH01-keyframe", "SC01-SH01-video-draft", "SC01-SH02-video-final", "SC01-SH02-voice"]);
  assert.deepEqual(skipped, [{ shotId: "s3", shot: "SC02-SH01", stage: "keyframes", reason: "Shot has no keyframe prompt" }]);
  const draft = jobs[1];
  assert.equal(draft.waitsFor, "SC01-SH01-keyframe");
  assert.equal(draft.credits, 30); // 5 s × 6 credits
  const final = jobs[2];
  assert.equal(final.seconds, 10); // 7 s shot rendered as 10 s clip
  assert.equal(final.credits, 120);
  assert.equal(jobs[3].speaker, "Mira");
});

test("manual stages produce no jobs", () => {
  const board = normalizeBoard(sampleBoard());
  board.settings.pipelineModes = {};
  const { jobs, skipped } = selectJobs(board, resolveStages(sampleConfig(), board.settings));
  assert.equal(jobs.length, 0);
  assert.ok(skipped.some((s) => s.reason === "Video stage is manual"));
});

test("keyframe prompt carries locked looks and style", () => {
  const board = normalizeBoard(sampleBoard());
  const p = keyframePrompt(board, board.shots[0], "stylized");
  assert.equal(p, "Mira meets Bolt, Mira: girl, red hair, 140 cm, Bolt: small robot, 45 cm, stylized");
});

test("video length snaps to 5 or 10 seconds", () => {
  assert.equal(videoSeconds({ duration: 3 }), 5);
  assert.equal(videoSeconds({ duration: 5 }), 5);
  assert.equal(videoSeconds({ duration: 5.5 }), 10);
});

test("mock jobs cost nothing", () => {
  const board = normalizeBoard(sampleBoard());
  board.settings.pipeline = { video: "Mock (test)" };
  const stages = resolveStages(sampleConfig(), board.settings);
  const job = selectJobs(board, stages).jobs.find((j) => j.stage === "video");
  assert.equal(job.provider, "mock");
  assert.equal(estimateUsd(job, stages), 0);
});

test("budget guard holds jobs that would pass the limit", () => {
  const board = normalizeBoard(sampleBoard({ purchases: [{ amount: 279 }] }));
  const stages = resolveStages(sampleConfig(), board.settings);
  const { jobs } = selectJobs(board, stages);
  assert.equal(estimateUsd(jobs[2], stages), 1.2);
  const { allowed, held, limitUsd } = applyBudget(jobs, stages, board, { totalUsd: 290, stopAtRemainingUsd: 10 });
  assert.equal(limitUsd, 280);
  assert.deepEqual(allowed.map((j) => j.id), ["SC01-SH01-keyframe", "SC01-SH01-video-draft", "SC01-SH02-voice"]);
  assert.deepEqual(held.map((j) => j.id), ["SC01-SH02-video-final"]);
});
