// Main simulation runner.
// Usage: pnpm sim --seed 42 --days 30 --config configs/baseline.json

import { getDb } from "../core/db.js";
import { runs } from "../core/schema.js";
import { config } from "../core/config.js";
import { simulateDay, mulberry32 } from "./traffic.js";
import { setDay, advanceDay } from "./clock.js";
import { operatorTick } from "../agents/operator.js";
import { seedStore } from "../core/seed.js";
import { withSpan, shutdownTracing, initTracing } from "../core/trace.js";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? (args[idx + 1] ?? fallback) : fallback;
}

const seed = parseInt(getArg("seed", String(config.simSeed)));
const days = parseInt(getArg("days", String(config.simDays)));

async function main() {
  await initTracing("store-simulation");
  const runId = randomUUID();
  let gitSha = "unknown";
  try {
    gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // Not a git repo or no commits yet
  }

  await withSpan("sim:run", { run_id: runId, seed, days, mock_llm: config.mockLlm ? 1 : 0 }, (rootSpan) =>
    simulate(runId, gitSha, rootSpan.id)
  );
  await shutdownTracing();
  console.log(`\n[sim] Run complete. ID: ${runId}`);
  console.log(`[sim] To evaluate: pnpm eval:compare ${runId} <other_run_id>`);
}

async function simulate(runId: string, gitSha: string, traceRoot: string) {
  const db = getDb();

  // Record run
  db.insert(runs).values({
    id: runId,
    seed,
    gitSha,
    configJson: JSON.stringify(config),
    traceRoot,
  }).run();

  seedStore();

  const rng = mulberry32(seed);

  console.log(`\n[sim] Starting run ${runId} | seed=${seed} | days=${days} | mock=${config.mockLlm}\n`);

  for (let day = 1; day <= days; day++) {
    setDay(day);
    console.log(`\n──────── Day ${day}/${days} ────────`);

    // 1. Generate traffic and purchases
    await simulateDay({ simDay: day, runId, rng });

    // 2. Operator check-in (delegates to Analytics, Content, Support)
    await operatorTick(day, runId);

    advanceDay();
  }
}

main().catch((err) => {
  console.error("[sim] Fatal error:", err);
  process.exit(1);
});
