// /ops — watch the agents work. Lists check-ins and replays each agent's
// thinking, tool calls and tool results, with sub-agent runs nested inline.

import { Hono } from "hono";
import { sqlAll } from "../core/db.js";
import { liveCheckIn } from "../agents/run-live.js";
import { config } from "../core/config.js";
import { render } from "./views/layout.js";
import {
  OpsIndexPage,
  OpsNotFoundPage,
  OpsRunPage,
  type RunRow,
  type RunTree,
  type StepRow,
} from "./views/ops.js";

export const ops = new Hono();

ops.get("/", (c) => {
  const runs = sqlAll<RunRow & { children: number; steps: number }>(`
    SELECT r.*,
      (SELECT COUNT(*) FROM agent_runs k WHERE k.parent_id = r.id) AS children,
      (SELECT COUNT(*) FROM agent_steps s WHERE s.agent_run_id = r.id) AS steps
    FROM agent_runs r WHERE r.parent_id IS NULL
    ORDER BY r.started_at DESC LIMIT 50`);
  return c.html(
    render(<OpsIndexPage runs={runs} teamRunning={checkInRunning} lastError={lastError} mock={config.mockLlm} />)
  );
});

// One team run at a time; the page polls while it's going.
let checkInRunning = false;
let lastError: string | null = null;
ops.post("/check-in", (c) => {
  if (!checkInRunning) {
    checkInRunning = true;
    lastError = null;
    liveCheckIn()
      .catch((e) => {
        lastError = e instanceof Error ? e.message : String(e);
        console.error("[ops] check-in failed", e);
      })
      .finally(() => (checkInRunning = false));
  }
  return c.redirect("/ops");
});

function loadRun(runId: string, depth = 0): RunTree | undefined {
  const [run] = sqlAll<RunRow>(`SELECT * FROM agent_runs WHERE id = ?`, runId);
  if (!run || depth > 5) return undefined;
  const steps = sqlAll<StepRow>(`SELECT * FROM agent_steps WHERE agent_run_id = ? ORDER BY seq`, runId);
  return {
    run,
    steps: steps.map((s) => ({
      ...s,
      child: s.kind === "tool_result" && s.child_run_id ? loadRun(s.child_run_id, depth + 1) : undefined,
    })),
  };
}

ops.get("/run/:id", (c) => {
  const tree = loadRun(c.req.param("id"));
  if (!tree) return c.html(render(<OpsNotFoundPage />), 404);
  const running = sqlAll(`SELECT 1 FROM agent_runs WHERE status='running'`).length > 0;
  return c.html(render(<OpsRunPage tree={tree} refresh={running} />));
});
