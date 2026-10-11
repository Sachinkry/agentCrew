// LLM client: Amazon Bedrock (Claude) + MOCK_LLM=1 for offline runs.
// Every call automatically writes an inference entry to the ledger.

import { z } from "zod";
import { config } from "./config.js";
import { withSpan } from "./trace.js";
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

// Per-1M-token pricing (approximate, in USD cents)
const PRICING: Record<string, { in: number; out: number }> = {
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { in: 300, out: 1500 },
  "anthropic.claude-3-5-haiku-20241022-v1:0": { in: 80, out: 400 },
  "anthropic.claude-3-haiku-20240307-v1:0": { in: 25, out: 125 },
};

function modelForTier(tier: ModelTier): string {
  if (tier === "strong") return config.modelStrong;
  if (tier === "mid") return config.modelMid;
  return config.modelCheap;
}

function estimateCost(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] ?? { in: 300, out: 1500 };
  return Math.ceil((inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out);
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
    `llm:${params.agent}`,
    { agent: params.agent, model, tier: params.tier },
    async (span) => {
      let result: LlmResult;

      if (config.mockLlm) {
        result = mockResponse(params.agent, params.userMessage);
        result.spanId = span.id;
      } else {
        const { BedrockRuntimeClient, InvokeModelCommand } = await import(
          "@aws-sdk/client-bedrock-runtime"
        );
        const client = new BedrockRuntimeClient({ region: config.awsRegion });

        const body = JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 4096,
          system: params.systemPrompt,
          messages: [{ role: "user", content: params.userMessage }],
        });

        const cmd = new InvokeModelCommand({
          modelId: model,
          contentType: "application/json",
          accept: "application/json",
          body,
        });

        const response = await client.send(cmd);
        const parsed = JSON.parse(
          Buffer.from(response.body).toString("utf-8")
        ) as {
          content: Array<{ text: string }>;
          usage: { input_tokens: number; output_tokens: number };
        };

        const text = parsed.content[0]?.text ?? "";
        const inTokens = parsed.usage.input_tokens;
        const outTokens = parsed.usage.output_tokens;
        const costCents = estimateCost(model, inTokens, outTokens);

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

// Parse LLM output with zod; retry once on failure
export async function callLlmParsed<T>(
  params: LlmCallParams,
  schema: z.ZodType<T>
): Promise<T> {
  const result = await callLlm(params);

  let raw: unknown;
  try {
    raw = JSON.parse(result.text);
  } catch {
    // Retry with error hint
    const retryParams = {
      ...params,
      userMessage: `${params.userMessage}\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY a JSON object matching the schema. Error: invalid JSON`,
    };
    const retry = await callLlm(retryParams);
    raw = JSON.parse(retry.text);
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
    raw2 = JSON.parse(retry2.text);
  } catch {
    throw new Error(`LLM output parse failed after retry: ${retry2.text}`);
  }
  return schema.parse(raw2);
}

export function addMockOutput(agent: string, value: string) {
  AGENT_MOCK_OUTPUTS[agent] = value;
}
