// ElevenLabs provider: dialogue lines as MP3, one saved voice per character.
import { ProviderError } from "./http.js";

export function createElevenLabs(stageConfig, ctx) {
  const api = stageConfig.api ?? {};
  const base = String(api.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const { fetch, env } = ctx;

  return {
    id: "elevenlabs",
    async generateSpeech({ text, speaker }) {
      const key = env[api.secretEnv ?? "ELEVENLABS_API_KEY"];
      if (!key) throw new ProviderError(`Set ${api.secretEnv ?? "ELEVENLABS_API_KEY"} to use ElevenLabs.`);
      const voiceId = stageConfig.voices?.[speaker];
      if (!voiceId || voiceId.startsWith("<")) throw new ProviderError(`No ElevenLabs voice id for "${speaker ?? "unknown speaker"}" in stages.voice.voices.`);
      const format = stageConfig.options?.outputFormat ?? "mp3_44100_128";
      const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(format)}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: stageConfig.model ?? "eleven_multilingual_v2" }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new ProviderError(`ElevenLabs failed with HTTP ${res.status}: ${body.slice(0, 300)}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
      }
      return { bytes: Buffer.from(await res.arrayBuffer()), ext: "mp3", meta: { voiceId, model: stageConfig.model ?? "eleven_multilingual_v2" } };
    },
  };
}
