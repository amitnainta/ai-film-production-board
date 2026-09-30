#!/usr/bin/env node
// film-worker: doctor | plan | run | assemble
//   --board <file|dir>   board export JSON or database dump dir (default: renders/board)
//   --config <file>      pipeline config (default: config/pipeline.json)
//   --out <dir>          where renders and results go (default: renders)
//   --inputs <dir>       downloaded keyframe assets (default: <out>/inputs)
//   --only <SC01-SH02>   limit to one shot (repeatable)
//   --confirm            required for `run` when any job uses a paid provider
//   --music <file>       assemble: music bed under the dialogue
//   --ffmpeg <path>      assemble: ffmpeg binary (else FFMPEG_PATH or PATH)
//   --edit-only          assemble: write edit files only, no video
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadBoard } from "./board.js";
import { budgetFrom, loadConfig, resolveStages, STAGES } from "./config.js";
import { applyBudget, spentUsd } from "./budget.js";
import { selectJobs } from "./jobs.js";
import { runJobs } from "./run.js";
import { assemble } from "./assemble.js";
import { defaultSleep } from "./providers/http.js";
import { PROVIDERS } from "./providers/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function main(argv = process.argv.slice(2), io = { log: console.log, env: process.env, fetch: globalThis.fetch }) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      board: { type: "string" }, config: { type: "string" }, out: { type: "string" }, inputs: { type: "string" },
      only: { type: "string", multiple: true }, confirm: { type: "boolean", default: false },
      music: { type: "string" }, ffmpeg: { type: "string" }, "edit-only": { type: "boolean", default: false },
    },
  });
  const cmd = positionals[0] ?? "plan";
  const out = path.resolve(values.out ?? path.join(ROOT, "renders"));
  const configFile = path.resolve(values.config ?? path.join(ROOT, "config/pipeline.json"));
  const { log, env } = io;

  const config = await loadConfig(configFile);

  if (cmd === "doctor") {
    let settings = {};
    try { settings = (await loadBoard(path.resolve(values.board ?? path.join(out, "board")))).settings; }
    catch { log("(No board dump found; checking config defaults. Pull the board first to check what it has chosen.)"); }
    return doctor(config, resolveStages(config, settings), configFile, env, log);
  }

  const board = await loadBoard(path.resolve(values.board ?? path.join(out, "board")));
  if (cmd === "assemble") {
    const res = await assemble(board, {
      outDir: path.join(out, "cut"), inputsDir: path.resolve(values.inputs ?? path.join(out, "inputs")), root: ROOT,
      title: board.settings.title || "Untitled film", assembly: config.assembly, music: values.music ? path.resolve(values.music) : null,
      ffmpeg: values.ffmpeg, env, log, render: !values["edit-only"],
    });
    log(`Edit files: ${Object.values(res.files).filter(Boolean).join(", ")}`);
    return res;
  }
  const stages = resolveStages(config, board.settings);
  let { jobs, skipped } = selectJobs(board, stages);
  if (values.only?.length) jobs = jobs.filter((j) => values.only.includes(j.shot));
  const budget = budgetFrom(config, board.settings);
  const { allowed, held, projectedUsd, limitUsd } = applyBudget(jobs, stages, board, budget);

  log(`Board: ${board.shots.length} shots · spent $${spentUsd(board)} of $${budget.totalUsd} budget`);
  log(`Stages: ${STAGES.map((s) => `${s}=${stages[s].mode}${stages[s].provider ? `/${stages[s].provider}` : ""}`).join("  ")}`);
  log("");
  if (!allowed.length) log("No jobs to run. Queue shots from the board's shot editor and set their stages to Automated.");
  for (const j of allowed) log(`  ${j.id.padEnd(26)} ${j.provider.padEnd(11)} ~$${j.estUsd.toFixed(2)}${j.credits ? `  ${j.credits} credits` : ""}${j.references?.length ? `  refs: ${j.references.map((r) => r.name).join(", ")}` : ""}`);
  for (const h of held) log(`  HELD ${h.id}: ${h.reason}`);
  for (const s of skipped) log(`  skip ${s.shot} ${s.stage}: ${s.reason}`);
  log("");
  log(`Projected spend after this run: $${projectedUsd}${limitUsd > 0 ? ` (limit $${limitUsd})` : ""}`);

  if (cmd === "plan") return { allowed, held, skipped };
  if (cmd !== "run") throw new Error(`Unknown command "${cmd}". Use doctor, plan, run or assemble.`);

  const paid = allowed.filter((j) => j.provider !== "mock");
  if (paid.length && !values.confirm) {
    log(`\n${paid.length} job(s) call paid providers. Re-run with --confirm to spend.`);
    return { allowed, held, skipped, ran: false };
  }
  if (!allowed.length) return { allowed, held, skipped, ran: false };
  const manifest = await runJobs(allowed, stages, {
    outDir: out, inputsDir: path.resolve(values.inputs ?? path.join(out, "inputs")),
    ctx: { fetch: io.fetch, env, log, sleep: io.sleep ?? defaultSleep, pollIntervalMs: io.pollIntervalMs },
  });
  const ok = manifest.results.filter((r) => r.status === "succeeded").length;
  log(`\nDone: ${ok}/${manifest.results.length} succeeded. Results: ${path.join(out, "results.json")}`);
  return { allowed, held, skipped, ran: true, manifest };
}

function doctor(config, stages, configFile, env, log) {
  const problems = [];
  log(`Config: ${configFile}`);
  for (const stage of STAGES) {
    const s = stages[stage];
    const p = s.provider ?? "(none)";
    log(`  ${stage.padEnd(10)} provider=${p} mode=${s.mode}${s.boardTool ? ` (board: ${s.boardTool})` : ""}${s.model && p !== "mock" ? ` model=${s.model}` : ""}`);
    if (s.blocked) problems.push(`${stage}: ${s.blocked}`);
    if (s.provider && !PROVIDERS.includes(s.provider)) problems.push(`${stage}: provider "${s.provider}" isn't supported (${PROVIDERS.join(", ")}).`);
    if (s.provider === "kling") {
      const api = s.api ?? {};
      const names = (api.auth ?? "jwt") === "apiKey" ? [api.apiKeyEnv ?? "KLING_API_KEY"] : [api.accessKeyEnv ?? "KLING_ACCESS_KEY", api.secretKeyEnv ?? "KLING_SECRET_KEY"];
      for (const n of names) if (!env[n]) problems.push(`${stage}: environment variable ${n} is not set.`);
      if (!s.model) problems.push(`${stage}: set a Kling model id.`);
    }
    const price = { keyframes: "usdPerImage", video: "usdPerCredit", voice: "usdPerLine" }[stage];
    if (s.provider && s.provider !== "mock" && !(Number(s[price]) > 0)) problems.push(`${stage}: ${price} is not set, so the budget guard counts this stage as free.`);
    if (s.provider === "elevenlabs") {
      const n = s.api?.secretEnv ?? "ELEVENLABS_API_KEY";
      if (!env[n]) problems.push(`${stage}: environment variable ${n} is not set.`);
      for (const [who, id] of Object.entries(s.voices ?? {})) if (!id || String(id).startsWith("<")) problems.push(`${stage}: voice id for ${who} is a placeholder.`);
    }
  }
  log(problems.length ? `\n${problems.length} problem(s):\n${problems.map((p) => "  - " + p).join("\n")}` : "\nAll set.");
  return { problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
}
