// Local host for the production board. Serves board/index.html with a shim
// (shim.js) that provides the Artifact runtime the page expects:
//   db        -> files under data/board (see store.js)
//   assets    -> files under data/assets, served at /_blob/<id>
//   sample    -> Claude via the Anthropic API (needs ANTHROPIC_API_KEY)
//   downloads -> a normal browser download
//   user      -> always allowed to write
// Listens on the loopback addresses only (127.0.0.1 and ::1). Port: PORT env var, default 5070 (see ports.md).
import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { askClaude, claudeAvailable } from "./claude.js";
import * as store from "./store.js";

const PORT = Number(process.env.PORT) || 5070;
const HOST = "127.0.0.1";

const PAGE = path.join(store.ROOT, "board", "index.html");
const SHIM = path.join(store.ROOT, "local", "shim.js");
const HELP = path.join(store.ROOT, "local", "help.html");
const MAX_JSON = 5 * 1024 * 1024;

// ---------- change notifications (Server-Sent Events) ----------
const clients = new Set();
let pending = new Set(), timer = null;
function notify(col) {
  pending.add(col);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const msg = `data: ${JSON.stringify({ collections: [...pending] })}\n\n`;
    pending = new Set();
    for (const res of clients) res.write(msg);
  }, 60);
}
await mkdir(store.BOARD, { recursive: true });
// Picks up writes made outside the server too (render results, hand edits).
watch(store.BOARD, { recursive: true }, (_e, file) => {
  const col = String(file || "").split(/[\\/]/)[0];
  if (col && !String(file).endsWith(".tmp")) notify(col);
});
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000).unref();

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "Cache-Control": "no-store", ...headers });
  res.end(text);
}
const fail = (res, status, code, message) => send(res, status, { ok: false, code, message });

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_JSON) throw Object.assign(new Error("Request too large"), { code: "quota_exceeded" }); chunks.push(c); }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function page() {
  const frag = await readFile(PAGE, "utf8");
  const cut = frag.indexOf("</style>") + "</style>".length;
  const head = cut > 7 ? frag.slice(0, cut) : "";
  const body = cut > 7 ? frag.slice(cut) : frag;
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<script src="/local/shim.js"></script>\n${head}</head><body>${body}</body></html>`;
}

async function serveBlob(req, res, id) {
  const a = await store.findAsset(id);
  if (!a) return send(res, 404, "Not found");
  const base = { "Content-Type": a.contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=31536000, immutable" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, a.size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), a.size - 1) : a.size - 1;
    if (start >= a.size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${a.size}` }); return res.end(); }
    res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${a.size}`, "Content-Length": end - start + 1 });
    return store.assetStream(a.file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, "Content-Length": a.size });
  store.assetStream(a.file).pipe(res);
}

// ---------- routes ----------
async function handle(req, res) {
  // Only answer requests addressed to this machine by name (guards against DNS rebinding).
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return send(res, 403, "Forbidden");
  // Writes need a custom header, which other websites can't send without a CORS preflight we never approve.
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-film-board"] !== "1") return send(res, 403, "Forbidden");

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return send(res, 200, await page(), { "Content-Type": "text/html; charset=utf-8" });
  }
  if (req.method === "GET" && (url.pathname === "/help" || url.pathname === "/help/")) {
    return send(res, 200, await readFile(HELP, "utf8"), { "Content-Type": "text/html; charset=utf-8" });
  }
  if (req.method === "GET" && url.pathname === "/local/shim.js") {
    return send(res, 200, await readFile(SHIM, "utf8"), { "Content-Type": "text/javascript; charset=utf-8" });
  }
  if (parts[0] === "_blob" && parts.length === 2 && req.method === "GET") return serveBlob(req, res, parts[1]);

  if (parts[0] !== "api") return send(res, 404, "Not found");

  if (parts[1] === "config" && req.method === "GET") return send(res, 200, { ok: true, sample: claudeAvailable() });

  if (parts[1] === "events" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (parts[1] === "db") {
    const [, , col, id] = parts;
    if (parts.length === 3 && req.method === "GET") return send(res, 200, { ok: true, docs: await store.listDocs(col) });
    if (parts.length === 4) {
      if (req.method === "GET") { const d = await store.getDoc(col, id); return send(res, 200, { ok: true, exists: !!d, data: d }); }
      if (req.method === "PUT") { await store.setDoc(col, id, await readJson(req)); notify(col); return send(res, 200, { ok: true }); }
      if (req.method === "PATCH") { await store.updateDoc(col, id, await readJson(req)); notify(col); return send(res, 200, { ok: true }); }
      if (req.method === "DELETE") { await store.deleteDoc(col, id); notify(col); return send(res, 200, { ok: true }); }
    }
  }

  if (parts[1] === "assets") {
    if (parts.length === 2 && req.method === "POST") {
      const name = decodeURIComponent(String(req.headers["x-file-name"] || ""));
      const id = await store.saveAssetStream(req, store.extFor(req.headers["content-type"], name));
      return send(res, 200, { ok: true, id, url: `/_blob/${id}` });
    }
    if (parts.length === 3 && req.method === "DELETE") { await store.deleteAsset(parts[2]); return send(res, 200, { ok: true }); }
  }

  if (parts[1] === "sample" && parts.length === 2 && req.method === "POST") {
    const { prompt, modelTier } = await readJson(req);
    if (typeof prompt !== "string" || !prompt.trim()) return fail(res, 400, "invalid_argument", "Empty prompt");
    const ctl = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ctl.abort(); });
    try { return send(res, 200, { ok: true, value: await askClaude(prompt, { modelTier, signal: ctl.signal }) }); }
    catch (e) { if (!ctl.signal.aborted) { console.error(`[claude] ${e.code || "error"}: ${e.message}`); return fail(res, 502, e.code || "error", e.message); } return; }
  }

  return send(res, 404, "Not found");
}

const onRequest = (req, res) => {
  handle(req, res).catch((e) => {
    console.error(`[${req.method} ${req.url}]`, e);
    if (!res.headersSent) fail(res, e.code === "invalid_argument" ? 400 : e instanceof SyntaxError ? 400 : 500, e.code || "error", e.message);
    else res.end();
  });
};

// "localhost" resolves to ::1 first on Windows, so listen on both loopbacks.
http.createServer(onRequest).listen(PORT, HOST, () => {
  console.log(`Production board: http://localhost:${PORT}  (help: http://localhost:${PORT}/help)`);
  console.log(`Data: ${store.DATA}`);
  console.log(`Claude features: ${claudeAvailable() ? "on" : "off (set ANTHROPIC_API_KEY to turn on script breakdown and prompt suggestions)"}`);
});
http.createServer(onRequest).on("error", () => { /* no IPv6 loopback; 127.0.0.1 is enough */ }).listen(PORT, "::1");
