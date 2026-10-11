import { z } from "zod";

const ConfigSchema = z.object({
  // LLM
  modelStrong: z.string().default("anthropic.claude-3-5-sonnet-20241022-v2:0"),
  modelMid: z.string().default("anthropic.claude-3-5-haiku-20241022-v1:0"),
  modelCheap: z.string().default("anthropic.claude-3-haiku-20240307-v1:0"),
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

  // AWS
  awsRegion: z.string().default("us-east-1"),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  return ConfigSchema.parse({
    modelStrong: process.env["BEDROCK_MODEL_STRONG"],
    modelMid: process.env["BEDROCK_MODEL_MID"],
    modelCheap: process.env["BEDROCK_MODEL_CHEAP"],
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
    awsRegion: process.env["AWS_REGION"],
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
