import { z } from "zod";
import { callLlmParsed } from "../core/llm.js";
import { withSpan } from "../core/trace.js";
import { getDb } from "../core/db.js";
import {
  tasks,
  experiments,
  products,
  events,
  runMetrics,
} from "../core/schema.js";
import { getDayMetrics, writeRunMetrics } from "../services/metrics.js";
import { runDiagnosis } from "./analytics.js";
import { runTask } from "./content.js";
import { check } from "../services/policy.js";
import { getPolicyBlockCount, resetPolicyBlockCount } from "../services/policy.js";
import { getClaimVerifiedRate } from "../services/verify.js";
import { config } from "../core/config.js";
import { randomUUID } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import fs from "fs";

const systemPrompt = fs.readFileSync(
  new URL("./prompts/operator.md", import.meta.url),
  "utf-8"
);

// ── Schemas ──────────────────────────────────────────────────────────────────

const OperatorActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    toAgent: z.enum(["content", "analytics", "support"]),
    brief: z.string(),
    metricCited: z.string(),
  }),
  z.object({
    type: z.literal("start_experiment"),
    hypothesis: z.string(),
    lever: z.enum([
      "price","listing","post_style","bundle","discount","new_product","retire",
    ]),
    targetId: z.string().optional(),
    params: z.record(z.unknown()),
    metricCited: z.string(),
  }),
  z.object({
    type: z.literal("close_experiment"),
    experimentId: z.string(),
    decision: z.enum(["keep", "revert"]),
    metricCited: z.string(),
  }),
  z.object({
    type: z.literal("set_price"),
    productId: z.string(),
    newPriceCents: z.number(),
    metricCited: z.string(),
  }),
  z.object({
    type: z.literal("retire_product"),
    productId: z.string(),
    metricCited: z.string(),
  }),
  z.object({
    type: z.literal("noop"),
    reason: z.string(),
  }),
]);

const OperatorOutputSchema = z.object({
  actions: z.array(OperatorActionSchema).max(config.maxActionsPerTick),
  reasoning: z.string(),
});

// ── Operator tick ─────────────────────────────────────────────────────────────

export async function operatorTick(
  simDay: number,
  runId: string
): Promise<void> {
  return withSpan(
    "operator:tick",
    { sim_day: simDay, run_id: runId },
    async (span) => {
      const db = getDb();

      // Get metrics and diagnosis
      const metrics = await getDayMetrics(simDay > 1 ? simDay - 1 : simDay);
      const diagnosis = await runDiagnosis(simDay, { runId });

      const activeExps = db
        .select()
        .from(experiments)
        .where(eq(experiments.decision, "pending"))
        .all();

      const liveProducts = db
        .select()
        .from(products)
        .where(eq(products.status, "live"))
        .all();

      // Ask LLM for strategy
      const output = await callLlmParsed(
        {
          agent: "operator",
          tier: "strong",
          systemPrompt,
          userMessage: `Day ${simDay} operator tick.

Yesterday metrics:
- Revenue: $${(metrics.revenueCents / 100).toFixed(2)}
- Profit: $${(metrics.profitCents / 100).toFixed(2)}
- Orders: ${metrics.orderCount}
- Inference cost: $${(metrics.inferenceCostCents / 100).toFixed(2)}
- Conversion (web): ${JSON.stringify(metrics.conversionByChannel["web"])}
- Conversion (x): ${JSON.stringify(metrics.conversionByChannel["x"])}

Analytics diagnosis: ${diagnosis.summary}

Active experiments: ${activeExps.length} / ${config.maxActionsPerTick}
Live products: ${liveProducts.map((p) => `${p.id}:${p.title}:$${(p.priceCents / 100).toFixed(2)}`).join(", ")}

Choose up to ${config.maxActionsPerTick} actions. Cite the metric for each.`,
          runId,
          simDay,
          parentSpanId: span.id,
        },
        OperatorOutputSchema
      );

      // Execute actions
      for (const action of output.actions) {
        await executeAction(action, simDay, runId, span.id);
      }

      // Auto-revert experiments with negative profit
      await checkAutoRevert(simDay, runId);

      // Write day metrics
      const policyBlocks = getPolicyBlockCount();
      resetPolicyBlockCount();
      const claimVerifiedRate = getClaimVerifiedRate();
      const dayMetrics = await getDayMetrics(simDay);
      writeRunMetrics(runId, dayMetrics, policyBlocks, claimVerifiedRate);

      db.insert(events)
        .values({
          id: randomUUID(),
          runId,
          simDay,
          agent: "operator",
          action: "tick",
          payloadJson: JSON.stringify({
            actionsCount: output.actions.length,
            reasoning: output.reasoning,
          }),
        })
        .run();
    }
  );
}

async function executeAction(
  action: z.infer<typeof OperatorActionSchema>,
  simDay: number,
  runId: string,
  parentSpanId?: string
): Promise<void> {
  const db = getDb();

  switch (action.type) {
    case "create_task": {
      const taskId = randomUUID();
      db.insert(tasks)
        .values({
          id: taskId,
          fromAgent: "operator",
          toAgent: action.toAgent,
          brief: action.brief,
          status: "open",
          simDay,
        })
        .run();

      if (action.toAgent === "content") {
        await runTask(taskId, { runId, simDay });
      }
      break;
    }

    case "start_experiment": {
      // One active experiment per (lever, target)
      const existing = db
        .select()
        .from(experiments)
        .where(
          and(
            eq(experiments.lever, action.lever),
            eq(experiments.decision, "pending")
          )
        )
        .get();

      if (existing) {
        console.log(
          `[operator] skipping experiment — already active for lever ${action.lever}`
        );
        break;
      }

      db.insert(experiments)
        .values({
          id: randomUUID(),
          hypothesis: action.hypothesis,
          lever: action.lever,
          targetId: action.targetId ?? null,
          paramsJson: JSON.stringify(action.params),
          startDay: simDay,
          decision: "pending",
        })
        .run();
      break;
    }

    case "close_experiment": {
      db.update(experiments)
        .set({ decision: action.decision, endDay: simDay })
        .where(eq(experiments.id, action.experimentId))
        .run();
      break;
    }

    case "set_price": {
      const product = db
        .select()
        .from(products)
        .where(eq(products.id, action.productId))
        .get();

      if (!product) break;

      const policyResult = check({
        type: "set_price",
        productId: action.productId,
        newPriceCents: action.newPriceCents,
        costCentsEst: product.costCentsEst,
        simDay,
        runId,
      });

      if (policyResult.allowed) {
        db.update(products)
          .set({ priceCents: action.newPriceCents })
          .where(eq(products.id, action.productId))
          .run();
      }
      break;
    }

    case "retire_product": {
      db.update(products)
        .set({ status: "retired" })
        .where(eq(products.id, action.productId))
        .run();
      break;
    }

    case "noop":
      console.log(`[operator] noop: ${action.reason}`);
      break;
  }

  db.insert(events)
    .values({
      id: randomUUID(),
      runId,
      simDay,
      agent: "operator",
      action: action.type,
      payloadJson: JSON.stringify(action),
    })
    .run();
}

async function checkAutoRevert(simDay: number, runId: string): Promise<void> {
  const db = getDb();
  const activeExps = db
    .select()
    .from(experiments)
    .where(eq(experiments.decision, "pending"))
    .all();

  for (const exp of activeExps) {
    if (!exp.resultJson) continue;
    try {
      const result = JSON.parse(exp.resultJson) as { profitDeltaCents?: number };
      if (result.profitDeltaCents !== undefined && result.profitDeltaCents < 0) {
        db.update(experiments)
          .set({ decision: "revert", endDay: simDay })
          .where(eq(experiments.id, exp.id))
          .run();
        console.log(
          `[operator] auto-reverted experiment ${exp.id} (negative profit delta)`
        );
        db.insert(events)
          .values({
            id: randomUUID(),
            runId,
            simDay,
            agent: "operator",
            action: "auto_revert_experiment",
            payloadJson: JSON.stringify({ experimentId: exp.id }),
          })
          .run();
      }
    } catch {
      // Ignore parse errors
    }
  }
}
