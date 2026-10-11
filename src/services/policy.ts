// Policy engine — every write action goes through policy.check().
// Blocks are logged to events and counted in run_metrics.policy_blocks.

import { z } from "zod";
import { config } from "../core/config.js";
import { getDb } from "../core/db.js";
import { events } from "../core/schema.js";
import { randomUUID } from "crypto";
import { inferenceCostByDay } from "./ledger.js";

export const PolicyActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_price"),
    productId: z.string(),
    newPriceCents: z.number(),
    costCentsEst: z.number(),
    simDay: z.number(),
    runId: z.string().optional(),
  }),
  z.object({
    type: z.literal("apply_discount"),
    productId: z.string(),
    discountPct: z.number(),
    priceCents: z.number(),
    costCentsEst: z.number(),
    simDay: z.number(),
    runId: z.string().optional(),
  }),
  z.object({
    type: z.literal("publish_post"),
    postId: z.string(),
    simDay: z.number(),
    runId: z.string().optional(),
  }),
  z.object({
    type: z.literal("propose_refund"),
    orderId: z.string(),
    amountCents: z.number(),
    simDay: z.number(),
    runId: z.string().optional(),
  }),
  z.object({
    type: z.literal("publish_listing"),
    productId: z.string(),
    claimsVerified: z.boolean(),
    simDay: z.number(),
    runId: z.string().optional(),
  }),
  z.object({
    type: z.literal("spend"),
    amountCents: z.number(),
    simDay: z.number(),
    runId: z.string().optional(),
  }),
]);

export type PolicyAction = z.infer<typeof PolicyActionSchema>;

interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

let _policyBlockCount = 0;

export function getPolicyBlockCount(): number {
  return _policyBlockCount;
}

export function resetPolicyBlockCount(): void {
  _policyBlockCount = 0;
}

function logBlock(
  action: PolicyAction,
  reason: string
): void {
  _policyBlockCount++;
  const db = getDb();
  db.insert(events).values({
    id: randomUUID(),
    runId: ("runId" in action ? action.runId : undefined) ?? null,
    simDay: action.simDay,
    agent: "policy",
    action: "block",
    payloadJson: JSON.stringify({ action, reason }),
  }).run();
  console.warn(`[policy] BLOCKED ${action.type}: ${reason}`);
}

export function check(action: PolicyAction): PolicyResult {
  switch (action.type) {
    case "set_price": {
      const marginPct =
        ((action.newPriceCents - action.costCentsEst) /
          action.newPriceCents) *
        100;
      if (marginPct < config.priceFloorMarginPct) {
        const reason = `margin ${marginPct.toFixed(1)}% below floor ${config.priceFloorMarginPct}%`;
        logBlock(action, reason);
        return { allowed: false, reason };
      }
      return { allowed: true };
    }

    case "apply_discount": {
      if (action.discountPct > config.maxDiscountPct) {
        const reason = `discount ${action.discountPct}% exceeds max ${config.maxDiscountPct}%`;
        logBlock(action, reason);
        return { allowed: false, reason };
      }
      const effectivePrice =
        action.priceCents * (1 - action.discountPct / 100);
      const marginPct =
        ((effectivePrice - action.costCentsEst) / effectivePrice) * 100;
      if (marginPct < 0) {
        const reason = `discount drives margin negative (${marginPct.toFixed(1)}%)`;
        logBlock(action, reason);
        return { allowed: false, reason };
      }
      return { allowed: true };
    }

    case "publish_post": {
      // Posts require approval (handled by approvals queue, not blocked here)
      return { allowed: true };
    }

    case "propose_refund": {
      if (action.amountCents > config.refundAutoApproveLimitCents) {
        const reason = `refund ${action.amountCents}¢ exceeds auto-approve limit ${config.refundAutoApproveLimitCents}¢ — needs human approval`;
        logBlock(action, reason);
        return { allowed: false, reason };
      }
      return { allowed: true };
    }

    case "publish_listing": {
      if (!action.claimsVerified) {
        const reason = "listing has unverified claims — run verify_claims first";
        logBlock(action, reason);
        return { allowed: false, reason };
      }
      return { allowed: true };
    }

    case "spend": {
      const todayInference = inferenceCostByDay(action.simDay);
      if (
        todayInference + action.amountCents >
        config.dailySpendCapCents
      ) {
        const reason = `daily spend cap ${config.dailySpendCapCents}¢ would be exceeded`;
        logBlock(action, reason);
        return { allowed: false, reason };
      }
      return { allowed: true };
    }
  }
}

export function requireAllowed(action: PolicyAction): void {
  const result = check(action);
  if (!result.allowed) {
    throw new Error(`Policy violation: ${result.reason}`);
  }
}
