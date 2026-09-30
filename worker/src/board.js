// Loads board state from either a board export (Pipeline tab → Export board JSON)
// or a database dump directory (<dir>/<collection>/<doc_id>.json, as written by
// Claude's ArtifactData `list` with `out_dir`).
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const COLLECTIONS = ["shots", "takes", "characters", "locations", "spend"];

export async function loadBoard(source) {
  const info = await stat(source);
  const raw = info.isDirectory() ? await loadDump(source) : JSON.parse(await readFile(source, "utf8"));
  return normalizeBoard(raw);
}

export function normalizeBoard(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Board file is empty or not JSON.");
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
  return {
    settings: raw.settings && typeof raw.settings === "object" ? raw.settings : {},
    script: typeof raw.script === "string" ? raw.script : "",
    characters: list(raw.characters),
    locations: list(raw.locations),
    shots: list(raw.shots),
    takes: list(raw.takes),
    purchases: list(raw.purchases ?? raw.spend),
  };
}

async function loadDump(dir) {
  const out = { settings: {}, script: "" };
  for (const name of COLLECTIONS) out[name] = await readCollection(path.join(dir, name));
  const settings = await readCollection(path.join(dir, "settings"));
  out.settings = settings.find((d) => d.id === "film") ?? {};
  const script = await readCollection(path.join(dir, "script"));
  out.script = script.find((d) => d.id === "main")?.text ?? "";
  out.purchases = out.spend;
  return out;
}

async function readCollection(dir) {
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const docs = [];
  for (const f of files.filter((f) => f.endsWith(".json")).sort()) {
    const doc = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    // Dump files may wrap the body as {id, data, version}; exports are flat.
    const body = doc && typeof doc.data === "object" && doc.data !== null ? doc.data : doc;
    docs.push({ ...body, id: doc.id ?? body.id ?? path.basename(f, ".json") });
  }
  return docs;
}

export function sortShots(shots) {
  return [...shots].sort((a, b) => num(a.scene) - num(b.scene) || num(a.no) - num(b.no));
}

export function slug(shot) {
  return `SC${String(num(shot.scene, 1)).padStart(2, "0")}-SH${String(num(shot.no, 1)).padStart(2, "0")}`;
}

export function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
