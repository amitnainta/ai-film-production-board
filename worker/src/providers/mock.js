// Mock provider: produces placeholder files instantly and costs nothing.
// Use it to rehearse a run end to end. Its outputs are marked `mock: true`
// and are never uploaded to the board.

// A valid 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

export function createMock() {
  return {
    id: "mock",
    async generateImage({ prompt, references = [] }) {
      return [{ bytes: PNG, ext: "png", meta: { mock: true, prompt, references: references.map((r) => r.name) } }];
    },
    async generateVideo({ prompt, seconds, kind }) {
      return { bytes: Buffer.from(`MOCK VIDEO ${kind} ${seconds}s: ${prompt}\n`), ext: "mock.txt", meta: { mock: true } };
    },
    async generateSpeech({ text, speaker }) {
      return { bytes: Buffer.from(`MOCK AUDIO ${speaker ?? ""}: ${text}\n`), ext: "mock.txt", meta: { mock: true } };
    },
  };
}
