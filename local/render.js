// Renders the local board's queue and writes the results back to it.
//   node local/render.js [--confirm] [--only SC01-SH02 ...]
// Reads data/board and data/assets; renders go to renders/ as usual.
import { main } from "../worker/src/cli.js";
import { applyResults } from "./apply.js";
import { ASSETS, BOARD } from "./store.js";

const args = process.argv.slice(2);
if (!args.includes("--board")) args.push("--board", BOARD);
if (!args.includes("--inputs")) args.push("--inputs", ASSETS);

try {
  const res = await main(["run", ...args]);
  if (!res || (!res.ran && !res.skipped?.length)) process.exit(0);
  if (res.ran === false && res.allowed?.length) process.exit(0); // paid jobs waiting for --confirm
  const sum = await applyResults(res.manifest, res.skipped, { log: console.log });
  console.log(`\nBoard updated: ${sum.keyframes} keyframe(s), ${sum.takes} take(s), ${sum.voice} voice line(s), ${sum.failed} failed, ${sum.skipped} skipped.`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
