// Cost estimates and the budget guard. Video cost is credits × usdPerCredit;
// images and speech use flat per-job estimates from the config.
import { num } from "./board.js";

export function estimateUsd(job, stages) {
  const s = stages[job.stage] ?? {};
  if (job.provider === "mock") return 0;
  if (job.stage === "video") return round(num(job.credits) * num(s.usdPerCredit, 0));
  if (job.stage === "keyframes") return round(num(s.usdPerImage, 0) * num(s.options?.variantsPerShot, 1));
  if (job.stage === "voice") return round(num(s.usdPerLine, 0));
  return 0;
}

export function spentUsd(board) {
  return round(board.purchases.reduce((a, p) => a + num(p.amount), 0));
}

// Walks jobs in order and keeps each one only while the running total stays
// inside the budget minus the safety margin.
export function applyBudget(jobs, stages, board, budget) {
  const limit = num(budget.totalUsd) - num(budget.stopAtRemainingUsd);
  let running = spentUsd(board);
  const allowed = [];
  const held = [];
  for (const job of jobs) {
    const cost = estimateUsd(job, stages);
    if (limit > 0 && running + cost > limit) {
      held.push({ ...job, estUsd: cost, reason: `Would pass the budget limit ($${round(running + cost)} of $${round(limit)})` });
      continue;
    }
    running += cost;
    allowed.push({ ...job, estUsd: cost });
  }
  return { allowed, held, projectedUsd: round(running), limitUsd: round(limit) };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
