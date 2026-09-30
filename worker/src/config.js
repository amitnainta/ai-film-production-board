// Loads config/pipeline.json and merges the board's per-stage choices over it.
// The board decides WHICH tool and WHETHER a stage is automated; the file holds
// provider details (endpoints, models, rates, secret names).
import { readFile } from "node:fs/promises";

export const STAGES = ["keyframes", "video", "voice"];

// Board tool names (Pipeline tab) → provider ids in this worker.
const TOOL_TO_PROVIDER = {
  "Kling 3.0": "kling",
  "Kling": "kling",
  "ElevenLabs": "elevenlabs",
  "Mock (test)": "mock",
};

export async function loadConfig(file) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  if (!raw.stages || typeof raw.stages !== "object") throw new Error(`${file} has no "stages" section.`);
  return raw;
}

export function resolveStages(config, boardSettings = {}) {
  const tools = boardSettings.pipeline ?? {};
  const modes = boardSettings.pipelineModes ?? {};
  const out = {};
  for (const stage of STAGES) {
    const base = config.stages[stage] ?? {};
    const boardTool = tools[stage];
    const boardProvider = boardTool ? TOOL_TO_PROVIDER[boardTool] : undefined;
    out[stage] = {
      ...base,
      mode: modes[stage] ?? base.mode ?? "manual",
      // A board tool with no worker provider (e.g. Midjourney) keeps the stage manual.
      provider: boardTool && !boardProvider ? null : boardProvider ?? base.provider ?? null,
      boardTool: boardTool ?? null,
    };
    if (out[stage].mode === "automated" && !out[stage].provider) {
      out[stage].blocked = `No automated provider for "${boardTool ?? "unset"}". Pick a supported tool (${Object.keys(TOOL_TO_PROVIDER).join(", ")}) or keep this stage manual.`;
    }
  }
  return out;
}

export function budgetFrom(config, boardSettings = {}) {
  return {
    totalUsd: Number(boardSettings.budget ?? config.budget?.totalUsd ?? 0),
    stopAtRemainingUsd: Number(config.budget?.stopAtRemainingUsd ?? 0),
  };
}
