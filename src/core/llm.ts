// Single-shot LLM calls on open-weight models via OpenRouter + MOCK_LLM=1 for offline runs.
// Every call automatically writes an inference entry to the ledger.

import { z } from "zod";
import { config } from "./config.js";
import { withSpan } from "./trace.js";
import { chat } from "./model.js";
import { getDb } from "./db.js";
import { llmCalls, ledger } from "./schema.js";
import { randomUUID } from "crypto";

export type ModelTier = "strong" | "mid" | "cheap";

interface LlmCallParams {
  agent: string;
  tier: ModelTier;
  systemPrompt: string;
  userMessage: string;
  runId?: string;
  simDay?: number;
  parentSpanId?: string;
}

interface LlmResult {
  text: string;
  inTokens: number;
  outTokens: number;
  costCents: number;
  spanId: string;
}

function modelForTier(tier: ModelTier): string {
  return tier === "cheap" ? config.modelCheap : config.model;
}

// Agent-aware canned mock outputs for offline runs
const AGENT_MOCK_OUTPUTS: Record<string, string> = {
  operator: JSON.stringify({
    actions: [{ type: "noop", reason: "mock mode — no real metrics yet" }],
    reasoning: "MOCK: operator noop",
  }),
  content: JSON.stringify({
    title: "Mock Product Title",
    description: "Mock description for testing.",
    hook: "Save time with this mock product.",
    bulletBenefits: ["Feature 1", "Feature 2", "Feature 3"],
    claimsToVerify: ["Has 3 features", "Works offline"],
    reasoning: "MOCK: content listing",
  }),
  analytics: JSON.stringify({
    funnelLeaks: [],
    topExperimentResults: [],
    buildList: [],
    retireList: [],
    summary: "MOCK: analytics diagnosis — no data yet",
  }),
  support: JSON.stringify({
    action: "reply",
    message: "Thank you for reaching out! Your issue has been noted. MOCK response.",
    reasoning: "MOCK: support reply",
  }),
  verify: JSON.stringify({
    results: [],
  }),
};

function mockResponse(agent: string, userMessage: string): LlmResult {
  const text =
    AGENT_MOCK_OUTPUTS[agent] ??
    AGENT_MOCK_OUTPUTS["operator"] ??
    "{}";
  return { text, inTokens: 100, outTokens: 50, costCents: 0, spanId: "mock" };
}

export async function callLlm(params: LlmCallParams): Promise<LlmResult> {
  const model = modelForTier(params.tier);

  return withSpan(
    `call:${params.agent}`,
    { agent: params.agent, model, tier: params.tier },
    async (span) => {
      let result: LlmResult;

      if (config.mockLlm) {
        result = mockResponse(params.agent, params.userMessage);
        result.spanId = span.id;
      } else {
        const res = await chat({
          agent: params.agent,
          model,
          system: params.systemPrompt,
          messages: [{ role: "user", content: params.userMessage }],
        });
        const text = res.text;
        const inTokens = res.inTokens;
        const outTokens = res.outTokens;
        const costCents = res.costCents;

        result = { text, inTokens, outTokens, costCents, spanId: span.id };
      }

      // Write to DB
      const db = getDb();
      const callId = randomUUID();
      db.insert(llmCalls).values({
        id: callId,
        runId: params.runId ?? null,
        agent: params.agent,
        model,
        inTokens: result.inTokens,
        outTokens: result.outTokens,
        costCents: result.costCents,
        spanId: result.spanId,
        simDay: params.simDay ?? null,
      }).run();

      if (result.costCents > 0) {
        db.insert(ledger).values({
          id: randomUUID(),
          simDay: params.simDay ?? 0,
          kind: "inference",
          amountCents: -result.costCents,
          refType: "llm_call",
          refId: callId,
        }).run();
      }

      return result;
    },
    params.parentSpanId
  );
}

// Open models often wrap JSON in ```json fences; strip them before parsing.
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced?.[1] ?? text).trim());
}

// Parse LLM output with zod; retry once on failure
export async function callLlmParsed<T>(
  params: LlmCallParams,
  schema: z.ZodType<T>
): Promise<T> {
  const result = await callLlm(params);

  let raw: unknown;
  try {
    raw = parseJson(result.text);
  } catch {
    // Retry with error hint
    const retryParams = {
      ...params,
      userMessage: `${params.userMessage}\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY a JSON object matching the schema. Error: invalid JSON`,
    };
    const retry = await callLlm(retryParams);
    raw = parseJson(retry.text);
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Retry with schema error
  const retryParams = {
    ...params,
    userMessage: `${params.userMessage}\n\nIMPORTANT: Your response did not match the required schema. Errors: ${JSON.stringify(parsed.error.issues)}. Return ONLY valid JSON.`,
  };
  const retry2 = await callLlm(retryParams);
  let raw2: unknown;
  try {
    raw2 = parseJson(retry2.text);
  } catch {
    throw new Error(`LLM output parse failed after retry: ${retry2.text}`);
  }
  return schema.parse(raw2);
}

export function addMockOutput(agent: string, value: string) {
  AGENT_MOCK_OUTPUTS[agent] = value;
}
