import { createElevenLabs } from "./elevenlabs.js";
import { createKling } from "./kling.js";
import { createMock } from "./mock.js";

const FACTORIES = { kling: createKling, elevenlabs: createElevenLabs, mock: createMock };

export function createProvider(id, stageConfig, ctx) {
  const make = FACTORIES[id];
  if (!make) throw new Error(`Unknown provider "${id}". Known: ${Object.keys(FACTORIES).join(", ")}.`);
  return make(stageConfig, ctx);
}

export const PROVIDERS = Object.keys(FACTORIES);
