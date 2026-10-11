// Runs the agent team against the live store.
// Usage: pnpm agents            → one operator check-in
//        pnpm agents --every 30 → a check-in every 30 minutes

import { operatorTick } from "./operator.js";
import { seedStore } from "../core/seed.js";
import { sqlAll } from "../core/db.js";
import { withSpan, shutdownTracing, initTracing } from "../core/trace.js";

export async function liveCheckIn() {
  seedStore();
  const day = (sqlAll<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent='operator' AND run_id IS NULL`)[0]?.n ?? 0) + 1;
  return withSpan("live:check-in", { day }, async () => {
    const r = await operatorTick(day);
    console.log(`\n[agents] check-in ${day} done → /ops/run/${r.agentRunId}\n${r.answer}`);
    return r;
  });
}

const isMain = process.argv[1]?.endsWith("run-live.ts");
if (isMain) {
  const i = process.argv.indexOf("--every");
  const minutes = i > -1 ? Number(process.argv[i + 1]) : 0;
  await initTracing("agent-check-in");
  await liveCheckIn();
  if (minutes === 0) await shutdownTracing();
  if (minutes > 0) {
    console.log(`[agents] next check-in every ${minutes} min`);
    setInterval(() => liveCheckIn().catch((e) => console.error("[agents]", e)), minutes * 60_000);
  }
}
