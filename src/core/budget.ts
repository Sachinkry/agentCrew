// Per-run token budget. One team run (an operator check-in plus every helper it
// calls) may use at most RUN_TOKEN_BUDGET tokens (input + output, incl. thinking).
//
// The operator spends from the run directly. When it hands a job to a helper, the
// job gets a grant from the pool: what the run has left, minus a reserve kept for
// the operator to finish, minus grants still running. A job whose grant would be
// below its minimum is refused before it starts. Unused grant goes back to the pool.
// The budget rides along the async call chain, so nested calls (e.g. verify inside
// content) draw from the same grant.

import { AsyncLocalStorage } from "async_hooks";
import { config } from "./config.js";

export const GRANT_POLICY = {
  // Share of the run kept back for the operator's own calls.
  operatorReserve: 0.2,
  // Grant when the operator doesn't ask for a size, as a share of the run.
  defaults: { analytics: 0.2, content: 0.4, support: 0.2 } as Record<string, number>,
  // Below this a job can't finish anything useful, so it isn't started.
  minimum: { analytics: 3_000, content: 6_000, support: 3_000 } as Record<string, number>,
};

export class TokenBudgetExceeded extends Error {}
export class BudgetRefused extends Error {}

interface Grant {
  agent: string;
  limit: number;
  used: number;
}

interface RunState {
  limit: number;
  used: number;
  byAgent: Map<string, number>;
  active: Set<Grant>;
}

interface Scope {
  run: RunState;
  grant?: Grant;
}

const store = new AsyncLocalStorage<Scope>();

export async function withTokenBudget<T>(
  fn: () => Promise<T>,
  limit = config.runTokenBudget
): Promise<{ result: T; used: number; limit: number; byAgent: Record<string, number> }> {
  const run: RunState = { limit, used: 0, byAgent: new Map(), active: new Set() };
  const result = await store.run({ run }, fn);
  return { result, used: run.used, limit, byAgent: Object.fromEntries(run.byAgent) };
}

/** Tokens free for new helper jobs right now (Infinity outside a run). */
export function grantPool(): number {
  const s = store.getStore();
  if (!s) return Infinity;
  const { run } = s;
  let held = 0;
  for (const g of run.active) held += Math.max(0, g.limit - g.used);
  return Math.max(0, run.limit - run.used - Math.floor(run.limit * GRANT_POLICY.operatorReserve) - held);
}

export type GrantDecision = { ok: true; tokens: number } | { ok: false; reason: string };

/** How many tokens a new job for this agent would get, or why it can't start. */
export function decideGrant(agent: string, requested?: number): GrantDecision {
  const s = store.getStore();
  if (!s) return { ok: true, tokens: Infinity };
  const pool = grantPool();
  const min = GRANT_POLICY.minimum[agent] ?? 0;
  const want = requested ?? Math.floor(s.run.limit * (GRANT_POLICY.defaults[agent] ?? 0));
  if (requested !== undefined && requested < min) {
    return { ok: false, reason: `${agent} needs at least ${min} tokens for a job; ${requested} was asked for` };
  }
  const tokens = Math.min(want, pool);
  if (tokens < min) {
    return { ok: false, reason: `${agent} not started: only ${pool} tokens free in this run, a job needs at least ${min}` };
  }
  return { ok: true, tokens };
}

/** Run a helper job inside its own grant. Throws BudgetRefused (without running fn) if no grant fits. */
export async function withGrant<T>(
  agent: string,
  requested: number | undefined,
  fn: () => Promise<T>
): Promise<{ result: T; granted: number; used: number }> {
  const s = store.getStore();
  if (!s) return { result: await fn(), granted: Infinity, used: 0 };
  const d = decideGrant(agent, requested);
  if (!d.ok) throw new BudgetRefused(d.reason);
  const grant: Grant = { agent, limit: d.tokens, used: 0 };
  s.run.active.add(grant);
  try {
    const result = await store.run({ run: s.run, grant }, fn);
    return { result, granted: grant.limit, used: grant.used };
  } finally {
    s.run.active.delete(grant);
  }
}

/** Tokens this agent may still spend: its grant if inside one, else the run (Infinity outside a run). */
export function tokensLeft(_agent: string): number {
  const s = store.getStore();
  if (!s) return Infinity;
  const runLeft = s.run.limit - s.run.used;
  return s.grant ? Math.min(runLeft, s.grant.limit - s.grant.used) : runLeft;
}

export function chargeTokens(agent: string, tokens: number): void {
  const s = store.getStore();
  if (!s) return;
  s.run.used += tokens;
  s.run.byAgent.set(agent, (s.run.byAgent.get(agent) ?? 0) + tokens);
  if (s.grant) s.grant.used += tokens;
}

/** Size of the budget the agent is working within, for messages. */
export function agentAllowance(_agent: string): number {
  const s = store.getStore();
  if (!s) return Infinity;
  return s.grant ? s.grant.limit : s.run.limit;
}

/** Tokens used so far in the current run (0 outside a run). */
export function tokensUsedInRun(): number {
  return store.getStore()?.run.used ?? 0;
}

/**
 * "final" when what's left covers this turn but not the one after, so the agent must wrap up now.
 * This turn ≈ nextPrompt + a typical reply; the one after re-sends that reply too.
 */
export function planTurn(left: number, nextPrompt: number, pastReplies: number[]): "normal" | "final" {
  if (pastReplies.length === 0) return "normal";
  const reply = pastReplies.reduce((a, b) => a + b, 0) / pastReplies.length;
  return left < 2 * nextPrompt + 3 * reply ? "final" : "normal";
}
