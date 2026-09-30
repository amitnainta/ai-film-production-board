// Small fetch helpers shared by providers. `fetch` and `sleep` are injected so
// tests can run providers without network access.

export class ProviderError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export async function requestJson(fetch, url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(`${init.method ?? "GET"} ${url} failed with HTTP ${res.status}: ${text.slice(0, 300)}`, {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  try { return JSON.parse(text); }
  catch { throw new ProviderError(`${url} returned non-JSON: ${text.slice(0, 200)}`); }
}

export async function download(fetch, url) {
  const res = await fetch(url);
  if (!res.ok) throw new ProviderError(`Download failed with HTTP ${res.status}: ${url}`, { status: res.status });
  return Buffer.from(await res.arrayBuffer());
}

// Calls `check` until it returns a non-undefined value or the timeout passes.
export async function poll(check, { intervalMs = 5000, timeoutMs = 600000, sleep = defaultSleep } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = await check();
    if (out !== undefined) return out;
    if (Date.now() + intervalMs > deadline) throw new ProviderError(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for the render.`);
    await sleep(intervalMs);
  }
}

export const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
