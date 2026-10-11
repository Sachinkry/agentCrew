import { z } from "zod";
import { callLlmParsed } from "../core/llm.js";
import { withSpan } from "../core/trace.js";
import { getDb } from "../core/db.js";
import {
  experiments,
  traffic,
  orders,
  channels,
  marketSignals,
  products,
  events,
} from "../core/schema.js";
import { getDayMetrics } from "../services/metrics.js";
import { config } from "../core/config.js";
import { randomUUID } from "crypto";
import { eq, sql, and, gte, lte } from "drizzle-orm";
import fs from "fs";

const systemPrompt = fs.readFileSync(
  new URL("./prompts/analytics.md", import.meta.url),
  "utf-8"
);

// ── Schemas ──────────────────────────────────────────────────────────────────

const FunnelReportSchema = z.object({
  channel: z.string(),
  sessions: z.number(),
  addToCart: z.number(),
  purchases: z.number(),
  sessionToCartRate: z.number(),
  cartToPurchaseRate: z.number(),
  overallRate: z.number(),
  diagnosis: z.string(),
  recommendation: z.string(),
});

const ExperimentScoreSchema = z.object({
  experimentId: z.string(),
  isSignificant: z.boolean(),
  sampleSize: z.number(),
  profitDeltaCents: z.number(),
  recommendation: z.enum(["keep", "revert", "insufficient_data"]),
  reasoning: z.string(),
});

const DiagnosisOutputSchema = z.object({
  funnelLeaks: z.array(FunnelReportSchema),
  topExperimentResults: z.array(ExperimentScoreSchema),
  buildList: z.array(
    z.object({
      productType: z.string(),
      expectedProfitScore: z.number(),
      rationale: z.string(),
    })
  ),
  retireList: z.array(
    z.object({ productId: z.string(), reason: z.string() })
  ),
  summary: z.string(),
});

// ── Funnel report ─────────────────────────────────────────────────────────────

export async function funnelReport(
  channelName: string,
  startDay: number,
  endDay: number
): Promise<z.infer<typeof FunnelReportSchema>> {
  const db = getDb();

  const channel = db
    .select()
    .from(channels)
    .where(eq(channels.name, channelName as "web" | "x" | "email"))
    .get();

  if (!channel) throw new Error(`Channel ${channelName} not found`);

  const trafficRows = db
    .select({
      sessions: sql<number>`COALESCE(SUM(sessions), 0)`,
      addToCart: sql<number>`COALESCE(SUM(add_to_cart), 0)`,
    })
    .from(traffic)
    .where(
      and(
        eq(traffic.channelId, channel.id),
        gte(traffic.simDay, startDay),
        lte(traffic.simDay, endDay)
      )
    )
    .get();

  const orderRows = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orders)
    .where(
      and(
        eq(orders.channelId, channel.id),
        gte(orders.simDay, startDay),
        lte(orders.simDay, endDay)
      )
    )
    .get();

  const sessions = trafficRows?.sessions ?? 0;
  const addToCart = trafficRows?.addToCart ?? 0;
  const purchases = orderRows?.count ?? 0;

  return {
    channel: channelName,
    sessions,
    addToCart,
    purchases,
    sessionToCartRate: sessions > 0 ? addToCart / sessions : 0,
    cartToPurchaseRate: addToCart > 0 ? purchases / addToCart : 0,
    overallRate: sessions > 0 ? purchases / sessions : 0,
    diagnosis:
      sessions < config.minExperimentSessions
        ? "Insufficient data"
        : purchases / sessions < 0.01
        ? "Low conversion"
        : "Healthy",
    recommendation:
      sessions < config.minExperimentSessions
        ? "Wait for more data"
        : "Optimize listing copy",
  };
}

// ── Score experiment ──────────────────────────────────────────────────────────

export async function scoreExperiment(
  experimentId: string,
  context: { runId?: string; simDay: number }
): Promise<z.infer<typeof ExperimentScoreSchema>> {
  return withSpan(
    "analytics:score_experiment",
    { experiment_id: experimentId },
    async (span) => {
      const db = getDb();

      const exp = db
        .select()
        .from(experiments)
        .where(eq(experiments.id, experimentId))
        .get();

      if (!exp) throw new Error(`Experiment ${experimentId} not found`);

      // Count sessions in experiment period
      const sessionCount = db
        .select({ total: sql<number>`COALESCE(SUM(sessions), 0)` })
        .from(traffic)
        .where(
          and(
            gte(traffic.simDay, exp.startDay),
            lte(traffic.simDay, exp.endDay ?? context.simDay)
          )
        )
        .get();

      const sampleSize = sessionCount?.total ?? 0;

      if (sampleSize < config.minExperimentSessions) {
        return {
          experimentId,
          isSignificant: false,
          sampleSize,
          profitDeltaCents: 0,
          recommendation: "insufficient_data",
          reasoning: `Only ${sampleSize} sessions; need ${config.minExperimentSessions} minimum`,
        };
      }

      const output = await callLlmParsed(
        {
          agent: "analytics",
          tier: "mid",
          systemPrompt,
          userMessage: `Score this experiment:
ID: ${experimentId}
Hypothesis: ${exp.hypothesis}
Lever: ${exp.lever}
Start day: ${exp.startDay}, Current day: ${context.simDay}
Sample size: ${sampleSize}
Existing results: ${exp.resultJson ?? "none"}

Is it significant? What's the profit delta? Keep or revert?`,
          runId: context.runId,
          simDay: context.simDay,
          parentSpanId: span.id,
        },
        ExperimentScoreSchema
      );

      // Update experiment record
      db.update(experiments)
        .set({ resultJson: JSON.stringify(output) })
        .where(eq(experiments.id, experimentId))
        .run();

      return output;
    }
  );
}

// ── Full diagnosis ────────────────────────────────────────────────────────────

export async function runDiagnosis(
  simDay: number,
  context: { runId?: string }
): Promise<z.infer<typeof DiagnosisOutputSchema>> {
  return withSpan(
    "analytics:diagnosis",
    { sim_day: simDay },
    async (span) => {
      const metrics = await getDayMetrics(simDay - 1 > 0 ? simDay - 1 : simDay);
      const webFunnel = await funnelReport("web", Math.max(1, simDay - 7), simDay);
      const xFunnel = await funnelReport("x", Math.max(1, simDay - 7), simDay);

      const db = getDb();
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

      const output = await callLlmParsed(
        {
          agent: "analytics",
          tier: "mid",
          systemPrompt,
          userMessage: `Run a full diagnosis for day ${simDay}.

Yesterday's metrics:
- Revenue: $${(metrics.revenueCents / 100).toFixed(2)}
- Profit: $${(metrics.profitCents / 100).toFixed(2)}
- Orders: ${metrics.orderCount}
- Inference cost: $${(metrics.inferenceCostCents / 100).toFixed(2)}

Web funnel (last 7 days): ${JSON.stringify(webFunnel)}
X funnel (last 7 days): ${JSON.stringify(xFunnel)}

Active experiments: ${activeExps.length}
Live products: ${liveProducts.map((p) => `${p.id}:${p.title}`).join(", ")}

Diagnose funnel leaks, score active experiments, and rank what to build/retire.`,
          runId: context.runId,
          simDay,
          parentSpanId: span.id,
        },
        DiagnosisOutputSchema
      );

      db.insert(events)
        .values({
          id: randomUUID(),
          runId: context.runId ?? null,
          simDay,
          agent: "analytics",
          action: "diagnosis",
          payloadJson: JSON.stringify({ summary: output.summary }),
        })
        .run();

      return output;
    }
  );
}
