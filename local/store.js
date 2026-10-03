// On-disk store for the local board. Documents live at
// data/board/<collection>/<id>.json as {id, data}, the same layout as an
// ArtifactData dump, so the render worker reads data/board directly.
// Assets live at data/assets/<id>.<ext>, which is where the worker looks for inputs.
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = path.resolve(process.env.FILM_DATA_DIR || path.join(ROOT, "data"));
export const BOARD = path.join(DATA, "board");
export const ASSETS = path.join(DATA, "assets");

const NAME = /^[A-Za-z0-9_-]{1,128}$/;
export const TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
};
const EXT_FOR_TYPE = { "image/jpeg": "jpg", "audio/mpeg": "mp3", "video/quicktime": "mov" };

export function newId() { return randomBytes(15).toString("base64url"); }

function check(...names) {
  for (const n of names) if (!NAME.test(String(n))) throw Object.assign(new Error(`Invalid name: ${n}`), { code: "invalid_argument" });
}
const docFile = (col, id) => path.join(BOARD, col, `${id}.json`);

async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text);
  // Windows can briefly refuse a rename while another process reads the file.
  for (let i = 0; ; i++) {
    try { return await rename(tmp, file); }
    catch (e) { if (i >= 5 || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) { await rm(tmp, { force: true }); throw e; } await new Promise((r) => setTimeout(r, 40 * (i + 1))); }
  }
}

function bodyOf(raw) { return raw && typeof raw.data === "object" && raw.data !== null ? raw.data : raw; }

export async function listDocs(col) {
  check(col);
  let files;
  try { files = await readdir(path.join(BOARD, col)); } catch { return []; }
  const docs = [];
  for (const f of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(await readFile(path.join(BOARD, col, f), "utf8"));
      const { id: _drop, ...data } = bodyOf(raw) ?? {};
      docs.push({ id: path.basename(f, ".json"), data });
    } catch { /* half-written or hand-edited file; skip it */ }
  }
  return docs;
}

export async function getDoc(col, id) {
  check(col, id);
  try {
    const { id: _drop, ...data } = bodyOf(JSON.parse(await readFile(docFile(col, id), "utf8"))) ?? {};
    return data;
  } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

export async function setDoc(col, id, data) {
  check(col, id);
  const { id: _drop, ...clean } = data ?? {};
  await writeAtomic(docFile(col, id), JSON.stringify({ id, data: clean }, null, 2));
}

export async function updateDoc(col, id, patch) {
  const cur = (await getDoc(col, id)) ?? {};
  await setDoc(col, id, { ...cur, ...patch });
}

export async function deleteDoc(col, id) {
  check(col, id);
  await rm(docFile(col, id), { force: true });
}

// ---------- assets ----------

export function extFor(contentType, fileName) {
  const fromName = path.extname(String(fileName || "")).slice(1).toLowerCase();
  if (fromName && TYPES[fromName]) return fromName;
  const t = String(contentType || "").split(";")[0].trim().toLowerCase();
  return EXT_FOR_TYPE[t] ?? Object.keys(TYPES).find((k) => TYPES[k] === t) ?? "bin";
}

export async function findAsset(id) {
  check(id);
  let files;
  try { files = await readdir(ASSETS); } catch { return null; }
  const hit = files.find((f) => f === id || f.startsWith(id + "."));
  if (!hit) return null;
  const file = path.join(ASSETS, hit);
  const ext = path.extname(hit).slice(1).toLowerCase();
  return { file, size: (await stat(file)).size, contentType: TYPES[ext] ?? "application/octet-stream" };
}

export async function saveAssetStream(readable, ext) {
  await mkdir(ASSETS, { recursive: true });
  const id = newId();
  const file = path.join(ASSETS, `${id}.${ext}`);
  try { await pipeline(readable, createWriteStream(file)); }
  catch (e) { await rm(file, { force: true }); throw e; }
  return id;
}

export async function importAssetFile(src) {
  await mkdir(ASSETS, { recursive: true });
  const id = newId();
  await copyFile(src, path.join(ASSETS, `${id}${path.extname(src).toLowerCase()}`));
  return id;
}

export async function deleteAsset(id) {
  const hit = await findAsset(id);
  if (hit) await rm(hit.file, { force: true });
}

export function assetStream(file, range) { return createReadStream(file, range); }
