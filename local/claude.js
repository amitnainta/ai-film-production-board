// Claude for the board's "Break down script" and "Suggest prompts" buttons.
// The page sends a prompt that asks for JSON only; this returns the parsed JSON.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.FILM_BOARD_MODEL || "claude-opus-5-5";
let client = null;

export function claudeAvailable() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function err(code, message) { return Object.assign(new Error(message), { code }); }

export function parseJsonReply(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ } }
  throw err("invalid_json", "Claude's reply wasn't valid JSON.");
}

export async function askClaude(prompt, { modelTier, signal } = {}) {
  if (!claudeAvailable()) throw err("sampling_disabled", "ANTHROPIC_API_KEY is not set.");
  client ??= new Anthropic();
  const params = {
    model: MODEL,
    max_tokens: 64000,
    // The script breakdown asks for the "default" tier; prompt suggestions are quick.
    output_config: { effort: modelTier === "default" ? "medium" : "low" },
    system: "You help plan an animated short film. Reply with only the JSON the user asks for: no prose, no code fences.",
    messages: [{ role: "user", content: prompt }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  let msg;
  try {
    msg = await client.beta.messages.stream(params, { signal }).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) throw err("cancelled", "Stopped.");
    if (e instanceof Anthropic.RateLimitError) throw err("rate_limited", e.message);
    if (e instanceof Anthropic.AuthenticationError) throw err("error", "The Anthropic API key was rejected.");
    if (e instanceof Anthropic.BadRequestError && /too long|too many tokens|context/i.test(e.message)) throw err("prompt_too_large", e.message);
    if (e instanceof Anthropic.APIError) throw err("error", `Anthropic API error ${e.status ?? ""}: ${e.message}`);
    throw e;
  }
  if (msg.stop_reason === "refusal") throw err("refused", msg.stop_details?.explanation || "Claude declined this request.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJsonReply(text);
}
