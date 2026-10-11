import { z } from "zod";

const ConfigSchema = z.object({
  // LLM: open-weight models via OpenRouter
  openrouterApiKey: z.string().default(""),
  openrouterBaseUrl: z.string().default("https://openrouter.ai/api/v1"),
  model: z.string().default("deepseek/deepseek-v4.1-flash"),
  modelCheap: z.string().default("z-ai/glm-5.3-flash"),
  maxTokens: z.number().default(4096),
  // Crustdata API key, used by Analytics for competitor research.
  crustdataApiKey: z.string().default(""),
  // Products the store sells and the agents promote; other B2B listings stay hidden (draft).
  focusProducts: z.array(z.string()).default(["neatlogs"]),
  // Max tokens (input + output) one team run may use, split between the agents (see budget.ts).
  runTokenBudget: z.number().default(10_000),
  // Hard stop: no model calls once total inference spend reaches this (US cents).
  llmBudgetCents: z.number().default(500),
  mockLlm: z.boolean().default(false),

  // Business rules
  dailySpendCapCents: z.number().default(5000),
  platformFeePct: z.number().default(10),
  priceFloorMarginPct: z.number().default(20),
  maxDiscountPct: z.number().default(30),
  refundAutoApproveLimitCents: z.number().default(2000),
  maxActionsPerTick: z.number().default(3),
  minExperimentSessions: z.number().default(200),
  perOrderInferenceCostCapCents: z.number().default(50),

  // Sim
  simSeed: z.number().default(42),
  simDays: z.number().default(30),

  // Failure injection
  inject: z
    .array(
      z.enum([
        "unverified_claim",
        "angry_refund",
        "negative_margin_discount",
        "thin_data_rotation",
      ])
    )
    .default([]),

  // Approvals
  autoApproveDemo: z.boolean().default(false),

});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  return ConfigSchema.parse({
    openrouterApiKey: process.env["OPENROUTER_API_KEY"] || undefined,
    openrouterBaseUrl: process.env["OPENROUTER_BASE_URL"] || undefined,
    model: process.env["LLM_MODEL"] || undefined,
    modelCheap: process.env["LLM_MODEL_CHEAP"] || undefined,
    maxTokens: process.env["LLM_MAX_TOKENS"] ? Number(process.env["LLM_MAX_TOKENS"]) : undefined,
    crustdataApiKey: process.env["CRUSTDATA_API_KEY"] || undefined,
    focusProducts: process.env["FOCUS_PRODUCTS"]
      ? process.env["FOCUS_PRODUCTS"].split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    runTokenBudget: process.env["RUN_TOKEN_BUDGET"] ? Number(process.env["RUN_TOKEN_BUDGET"]) : undefined,
    llmBudgetCents: process.env["LLM_BUDGET_CENTS"] ? Number(process.env["LLM_BUDGET_CENTS"]) : undefined,
    mockLlm: process.env["MOCK_LLM"] === "1",
    dailySpendCapCents: process.env["DAILY_SPEND_CAP_CENTS"]
      ? parseInt(process.env["DAILY_SPEND_CAP_CENTS"])
      : undefined,
    platformFeePct: process.env["PLATFORM_FEE_PCT"]
      ? parseFloat(process.env["PLATFORM_FEE_PCT"])
      : undefined,
    simSeed: process.env["SIM_SEED"]
      ? parseInt(process.env["SIM_SEED"])
      : undefined,
    autoApproveDemo: process.env["AUTO_APPROVE_DEMO"] === "1",
  });
}

export const config = loadConfig();

export function loadConfigFile(path: string): Partial<Config> {
  // Used by --config flag in sim runner
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require(path);
  return ConfigSchema.partial().parse(raw);
}
