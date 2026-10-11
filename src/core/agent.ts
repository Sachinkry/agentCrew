// Shared agent loop: the model thinks, calls tools, reads results, repeats until done.
// Runs on open-weight models via OpenRouter (see model.ts). Every thinking
// block, tool call and tool result is saved to agent_steps so /ops can replay how
// each agent worked, and the same tree goes to neatlogs as AGENT/LLM/TOOL spans.
// MOCK_LLM=1 swaps the model for a scripted stand-in that drives the same tools.

import { randomUUID } from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { agentRuns, agentSteps, llmCalls, ledger } from "./schema.js";
import { withSpan } from "./trace.js";
import { chat, estimatePromptTokens, fitMessages, type ChatMessage, type JsonSchema, type ToolDef } from "./model.js";
import { TokenBudgetExceeded, planTurn, tokensLeft } from "./budget.js";

export type AgentName = "operator" | "content" | "analytics" | "support";
export type Effort = "low" | "medium" | "high";

export interface AgentCtx {
  runId?: string;
  simDay: number;
  agentRunId: string;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
  run: (input: Record<string, unknown>, ctx: AgentCtx) => Promise<unknown>;
}

// One scripted turn for mock mode: what the agent "thinks", then which tools it calls.
export interface MockTurn {
  thinking: string;
  calls?: Array<{ name: string; input: Record<string, unknown> }>;
  answer?: string;
}
export type MockHistory = Array<{ name: string; input: Record<string, unknown>; result: unknown }>;
export type MockScript = (history: MockHistory, task: string) => MockTurn;

export interface AgentSpec {
  agent: AgentName;
  system: string;
  tools: AgentTool[];
  effort: Effort;
  mock: MockScript;
}

export interface AgentRunResult {
  agentRunId: string;
  answer: string;
}

/** An agent's instructions live in src/agents/prompts/<name>.md so they can be edited without touching code. */
export function loadPrompt(name: AgentName): string {
  const file = fileURLToPath(new URL(`../agents/prompts/${name}.md`, import.meta.url));
  return fs.readFileSync(file, "utf-8").trim();
}

const MAX_TURNS = 10;

/** Required tool inputs the model left out (null counts as missing). */
export function missingArgs(schema: JsonSchema, input: Record<string, unknown>): string[] {
  return (schema.required ?? []).filter((k) => input[k] === undefined || input[k] === null);
}

// Room kept for the last reply (capped thinking + a short report) when trimming history to fit.
export const FINAL_REPLY_TOKENS = 1_500;

/**
 * Decide this turn before calling the model: normal, or final (one last action + report).
 * If the full history no longer fits, old tool results are trimmed so a final turn still can.
 * messages is null when nothing fits.
 */
export function prepareTurn(t: {
  left: number;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  replies: number[];
  retried: boolean;
}): { final: boolean; messages: ChatMessage[] | null } {
  const prompt = estimatePromptTokens(t.system, t.messages, t.tools);
  if (t.left - prompt < FINAL_REPLY_TOKENS) {
    return { final: true, messages: fitMessages(t.system, t.messages, t.tools, t.left - FINAL_REPLY_TOKENS) };
  }
  return { final: t.retried || planTurn(t.left, prompt, t.replies) === "final", messages: t.messages };
}

export type NextStep =
  | { do: "tools" }
  | { do: "tools-then-return"; text: string }
  | { do: "return"; text: string }
  | { do: "retry"; note: string };

/** What the loop does with a model reply. An empty reply is retried once (tools off), never passed up as "". */
export function nextStep(
  res: { text: string; toolUses: unknown[]; stopReason: string },
  turn: { final: boolean; retried: boolean }
): NextStep {
  if (res.toolUses.length > 0 && !turn.final) return { do: "tools" };
  // Budget-final turn: one last action is allowed, then the run ends.
  if (res.toolUses.length > 0 && !turn.retried) return { do: "tools-then-return", text: res.text };
  if (res.text.trim()) return { do: "return", text: res.text };
  if (!turn.retried) {
    return {
      do: "retry",
      note: `Your last reply was cut off before you answered (stop reason: ${res.stopReason || "none"}). Don't call tools. Reply now, briefly: what you finished, what is unfinished, and what should happen next.`,
    };
  }
  return { do: "return", text: `No answer: the reply was cut off twice (stop reason: ${res.stopReason || "none"}).` };
}

class StepWriter {
  private seq = 0;
  constructor(private agentRunId: string) {}

  write(step: {
    kind: "thinking" | "text" | "tool_call" | "tool_result" | "error";
    content: string;
    toolName?: string;
    isError?: boolean;
    childRunId?: string;
  }) {
    getDb()
      .insert(agentSteps)
      .values({
        id: randomUUID(),
        agentRunId: this.agentRunId,
        seq: this.seq++,
        kind: step.kind,
        content: step.content,
        toolName: step.toolName ?? null,
        isError: step.isError ?? false,
        childRunId: step.childRunId ?? null,
        ts: new Date(),
      })
      .run();
  }
}

// Sub-agents started from inside a tool register here so the parent's
// tool_result step can link to the child run.
const lastChildRun = new Map<string, string>();

export function noteChildRun(parentAgentRunId: string, childRunId: string) {
  lastChildRun.set(parentAgentRunId, childRunId);
}

export async function runAgent(
  spec: AgentSpec,
  task: string,
  opts: { runId?: string; simDay: number; parentId?: string }
): Promise<AgentRunResult> {
  const db = getDb();
  const agentRunId = randomUUID();
  db.insert(agentRuns)
    .values({
      id: agentRunId,
      runId: opts.runId ?? null,
      parentId: opts.parentId ?? null,
      agent: spec.agent,
      task,
      simDay: opts.simDay,
      startedAt: new Date(),
    })
    .run();
  if (opts.parentId) noteChildRun(opts.parentId, agentRunId);

  const ctx: AgentCtx = { runId: opts.runId, simDay: opts.simDay, agentRunId };
  const steps = new StepWriter(agentRunId);
  const toolsByName = new Map(spec.tools.map((t) => [t.name, t]));
  let costCents = 0;

  return withSpan(`agent:${spec.agent}`, { agent: spec.agent, agent_run_id: agentRunId, task }, async () => {
    try {
      const answer = config.mockLlm
        ? await mockLoop(spec, task, ctx, steps, toolsByName)
        : await modelLoop(spec, task, ctx, steps, toolsByName, (c) => (costCents += c));

      db.update(agentRuns)
        .set({ status: "done", result: answer, costCents, endedAt: new Date() })
        .where(eq(agentRuns.id, agentRunId))
        .run();
      return { agentRunId, answer };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.write({ kind: "error", content: msg, isError: true });
      db.update(agentRuns)
        .set({ status: "failed", result: msg, costCents, endedAt: new Date() })
        .where(eq(agentRuns.id, agentRunId))
        .run();
      throw err;
    }
  });
}

async function execTool(
  tool: AgentTool | undefined,
  name: string,
  input: Record<string, unknown>,
  ctx: AgentCtx,
  steps: StepWriter
): Promise<{ text: string; isError: boolean }> {
  steps.write({ kind: "tool_call", toolName: name, content: JSON.stringify(input, null, 2) });
  let text: string;
  let isError = false;
  lastChildRun.delete(ctx.agentRunId);
  try {
    if (!tool) throw new Error(`unknown tool ${name}`);
    const missing = missingArgs(tool.input_schema, input);
    if (missing.length) throw new Error(`missing required input: ${missing.join(", ")}. Call ${name} again with them.`);
    const result = await withSpan(`tool:${name}`, { tool: name }, () => tool.run(input, ctx));
    text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (err) {
    text = err instanceof Error ? err.message : String(err);
    isError = true;
  }
  steps.write({
    kind: "tool_result",
    toolName: name,
    content: text,
    isError,
    ...(lastChildRun.has(ctx.agentRunId) ? { childRunId: lastChildRun.get(ctx.agentRunId)! } : {}),
  });
  return { text, isError };
}

const FINAL_TURN_NOTE =
  "Token budget: this is your last turn. Make the single most valuable remaining tool call(s) now, if any, and in the same reply give your final report: what you finished, what is unfinished, and what should happen next. Keep the report short; don't paste drafts into it.";

async function modelLoop(
  spec: AgentSpec,
  task: string,
  ctx: AgentCtx,
  steps: StepWriter,
  toolsByName: Map<string, AgentTool>,
  addCost: (cents: number) => void
): Promise<string> {
  const messages: ChatMessage[] = [{ role: "user", content: task }];

  let lastText = "";
  const replies: number[] = [];
  let retried = false;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const plan = prepareTurn({
      left: tokensLeft(spec.agent),
      system: spec.system,
      messages,
      tools: spec.tools,
      replies,
      retried,
    });
    const final = plan.final;
    const send = plan.messages ?? messages; // null: let chat() refuse and stop below
    if (final && !retried) {
      steps.write({
        kind: "text",
        content:
          send === messages
            ? "Budget check: last affordable turn — one final action, then report."
            : "Budget check: history trimmed to fit a last turn — one final action, then report.",
      });
      const note: ChatMessage = { role: "user", content: FINAL_TURN_NOTE };
      messages.push(note);
      if (send !== messages) send.push(note);
    }
    let res;
    try {
      res = await chat({
        agent: spec.agent,
        system: spec.system,
        messages: send,
        tools: spec.tools,
        effort: spec.effort,
        ...(retried ? { toolChoice: "none" as const } : {}),
      });
    } catch (err) {
      if (!(err instanceof TokenBudgetExceeded)) throw err;
      // Out of tokens for this run: stop cleanly and hand back what we have.
      const note = `Stopped early: ${err.message}.`;
      steps.write({ kind: "text", content: note });
      return lastText ? `${lastText}\n\n${note}` : note;
    }
    if (res.text) lastText = res.text;
    replies.push(res.outTokens);
    addCost(res.costCents);
    recordLlmCost(spec.agent, ctx, res.model, res.inTokens, res.outTokens, res.costCents);

    if (res.reasoning) steps.write({ kind: "thinking", content: res.reasoning });
    if (res.text) steps.write({ kind: "text", content: res.text });
    messages.push(res.message);

    const step = nextStep(res, { final, retried });
    if (step.do === "return") return step.text;
    if (step.do === "tools-then-return") {
      const outcomes: string[] = [];
      for (const use of res.toolUses) {
        const { text, isError } = await execTool(toolsByName.get(use.name), use.name, use.input, ctx, steps);
        outcomes.push(isError ? `${use.name} failed: ${text}` : `${use.name} ok`);
      }
      return `${step.text}\n\nLast actions: ${outcomes.join("; ")}.`.trim();
    }
    if (step.do === "retry") {
      retried = true;
      steps.write({ kind: "text", content: "Reply was cut off with no answer; asking once more for a short final answer." });
      messages.push({ role: "user", content: step.note });
      continue;
    }

    for (const use of res.toolUses) {
      const { text, isError } = await execTool(toolsByName.get(use.name), use.name, use.input, ctx, steps);
      messages.push({ role: "tool", tool_call_id: use.id, content: isError ? `ERROR: ${text}` : text });
    }
  }
  return "Stopped: hit the turn limit.";
}

async function mockLoop(
  spec: AgentSpec,
  task: string,
  ctx: AgentCtx,
  steps: StepWriter,
  toolsByName: Map<string, AgentTool>
): Promise<string> {
  const history: MockHistory = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const step = spec.mock(history, task);
    steps.write({ kind: "thinking", content: step.thinking });
    if (!step.calls?.length) {
      const answer = step.answer ?? "Done.";
      steps.write({ kind: "text", content: answer });
      return answer;
    }
    for (const call of step.calls) {
      const { text, isError } = await execTool(toolsByName.get(call.name), call.name, call.input, ctx, steps);
      let result: unknown = text;
      try {
        result = JSON.parse(text);
      } catch {
        // plain-text result
      }
      history.push({ name: call.name, input: call.input, result: isError ? { error: text } : result });
    }
  }
  return "Stopped: hit the turn limit.";
}

function recordLlmCost(agent: string, ctx: AgentCtx, model: string, inTok: number, outTok: number, cents: number) {
  const db = getDb();
  const callId = randomUUID();
  db.insert(llmCalls)
    .values({
      id: callId,
      runId: ctx.runId ?? null,
      agent,
      model,
      inTokens: inTok,
      outTokens: outTok,
      costCents: Math.ceil(cents),
      spanId: ctx.agentRunId,
      simDay: ctx.simDay,
    })
    .run();
  if (cents > 0) {
    db.insert(ledger)
      .values({
        id: randomUUID(),
        simDay: ctx.simDay,
        kind: "inference",
        amountCents: -Math.ceil(cents),
        refType: "llm_call",
        refId: callId,
      })
      .run();
  }
}

// Helper for mock scripts: the most recent result of a given tool.
export function lastResult<T = any>(
  history: MockHistory,
  name: string
): T | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.name === name) return history[i]!.result as T;
  }
  return undefined;
}
