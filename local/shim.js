// Browser side of the local board: provides window.claude.use(name) with the
// same shapes the published Artifact runtime gives board/index.html, backed by
// the local server (server.js).
(() => {
  const H = { "X-Film-Board": "1" };
  const fail = (code, message) => Object.assign(new Error(message || code), { code });

  async function api(method, url, body) {
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: body === undefined ? H : { ...H, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) { throw fail("unavailable", "The local board server isn't reachable. Is it running?"); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw fail(j.code || "error", j.message || `HTTP ${r.status}`);
    return j;
  }

  const newId = () => {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => abc[b % abc.length]).join("");
  };
  const enc = encodeURIComponent;

  // ---------- live updates ----------
  const listeners = new Map(); // "col" or "col/id" -> Set(refresh fn)
  function refresh(col) {
    for (const [key, fns] of listeners) if (key === col || key.startsWith(col + "/")) fns.forEach((fn) => fn());
  }
  function refreshAll() { for (const fns of listeners.values()) fns.forEach((fn) => fn()); }
  let opened = false;
  const es = new EventSource("/api/events");
  es.onmessage = (m) => { try { JSON.parse(m.data).collections.forEach(refresh); } catch {} };
  es.onopen = () => { if (opened) refreshAll(); opened = true; }; // resync after a server restart

  function subscribe(key, load, cb, onErr) {
    let seq = 0;
    const run = async () => {
      const mine = ++seq;
      try { const v = await load(); if (mine === seq) cb(v); }
      catch (e) { if (mine === seq && onErr) onErr(e); }
    };
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(run);
    run();
    return () => listeners.get(key).delete(run);
  }

  // ---------- db ----------
  const docSnap = (id, r) => ({ id, exists: !!r.exists, data: () => (r.exists ? r.data : undefined) });
  function docRef(col, id) {
    const url = `/api/db/${enc(col)}/${enc(id)}`;
    const get = async () => docSnap(id, await api("GET", url));
    const write = async (method, data) => { await api(method, url, data); refresh(col); };
    return {
      id,
      get,
      set: (data) => write("PUT", data),
      update: (patch) => write("PATCH", patch),
      delete: () => write("DELETE"),
      onSnapshot: (cb, onErr) => subscribe(`${col}/${id}`, get, cb, onErr),
    };
  }
  function collection(col) {
    const get = async () => {
      const r = await api("GET", `/api/db/${enc(col)}`);
      const docs = r.docs.map((d) => ({ id: d.id, exists: true, data: () => d.data }));
      return { docs, size: docs.length, empty: !docs.length };
    };
    return {
      doc: (id) => docRef(col, id || newId()),
      get,
      onSnapshot: (cb, onErr) => subscribe(col, get, cb, onErr),
    };
  }
  const db = {
    collection,
    doc: (p) => { const [col, id] = String(p).split("/"); return docRef(col, id); },
  };

  // ---------- assets ----------
  const assets = {
    async upload(file) {
      let r;
      try {
        r = await fetch("/api/assets", {
          method: "POST",
          headers: { ...H, "Content-Type": file.type || "application/octet-stream", "X-File-Name": enc(file.name || "") },
          body: file,
        });
      } catch { throw fail("unavailable", "The local board server isn't reachable."); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw fail(j.code || "error", j.message || `Upload failed (HTTP ${r.status})`);
      return { id: j.id, url: j.url };
    },
    async delete(id) { await api("DELETE", `/api/assets/${enc(id)}`); },
    url: (id) => `/_blob/${enc(id)}`,
  };

  // ---------- sample (Claude) ----------
  const sample = {
    async json(prompt, opts = {}) {
      let r;
      try {
        r = await fetch("/api/sample", {
          method: "POST",
          headers: { ...H, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, modelTier: opts.modelTier }),
          signal: opts.signal,
        });
      } catch (e) {
        if (e && e.name === "AbortError") throw fail("cancelled", "Stopped.");
        throw fail("unavailable", "The local board server isn't reachable.");
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw fail(j.code || "error", j.message);
      return j.value;
    },
  };

  // ---------- downloads ----------
  const downloads = {
    async save({ filename, data, mimeType }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType || (String(filename).endsWith(".json") ? "application/json" : "text/plain") });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || "download";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    },
  };

  const user = { can: async () => true, name: "You" };

  // ---------- Help button (local edition only; the published board has none) ----------
  document.addEventListener("DOMContentLoaded", () => {
    const a = document.createElement("a");
    a.href = "/help"; a.target = "_blank"; a.rel = "noopener"; a.textContent = "? Help";
    a.title = "Help: starting, stopping, API keys and the production workflow";
    a.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:50;padding:8px 14px;border-radius:999px;" +
      "background:var(--accent);color:var(--accent-ink);font:600 13px/1 var(--f-body);text-decoration:none;box-shadow:var(--shadow)";
    document.body.appendChild(a);
  });

  let config = null;
  const getConfig = () => (config ??= api("GET", "/api/config").catch(() => ({ sample: false })));

  window.claude = {
    async use(name) {
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "downloads") return downloads;
      if (name === "user") return user;
      if (name === "sample") return (await getConfig()).sample ? sample : null;
      return null;
    },
  };
})();
