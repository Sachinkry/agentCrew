// Chat client for open-weight models (DeepSeek, GLM, ...) via OpenRouter.
// Each call is an LLM span in neatlogs carrying the messages, the model's
// reasoning ("thinking"), tool calls, token usage and cost.

import { config } from "./config.js";
import { sqlAll } from "./db.js";
import { withSpan } from "./trace.js";
import { TokenBudgetExceeded, agentAllowance, chargeTokens, tokensLeft } from "./budget.js";

// Below this many tokens of room for a reply, don't start a call.
const MIN_REPLY_TOKENS = 200;

export interface JsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// OpenAI-style chat messages, as OpenRouter accepts them.
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_details?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResult {
  model: string;
  text: string;
  reasoning: string;
  toolUses: ToolUse[];
  /** The assistant turn to append to the conversation. */
  message: ChatMessage;
  stopReason: string;
  inTokens: number;
  outTokens: number;
  costCents: number;
}

/** Estimated inference spend so far, from the ledger (all runs, all days). */
export function inferenceSpentCents(): number {
  const [row] = sqlAll<{ spent: number | null }>(
    `SELECT -SUM(amount_cents) AS spent FROM ledger WHERE kind = 'inference'`
  );
  return row?.spent ?? 0;
}

// Some models return reasoning inline as <think>…</think> instead of a separate field.
const THINK_TAG = /<think>([\s\S]*?)<\/think>/g;

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function messageText(m: ChatMessage): string {
  if (m.role === "tool") return `[tool result ${m.tool_call_id}] ${m.content}`;
  if (m.role === "assistant")
    return [m.content ?? "", ...(m.tool_calls ?? []).map((t) => `[tool call ${t.function.name}] ${t.function.arguments}`)]
      .filter(Boolean)
      .join("\n");
  return m.content;
}

/** Conservative prompt size (~3 chars/token). */
export function estimatePromptTokens(system: string, messages: ChatMessage[], tools?: ToolDef[]): number {
  const chars =
    system.length + messages.reduce((n, m) => n + messageText(m).length, 0) + JSON.stringify(tools ?? []).length;
  return Math.ceil(chars / 3);
}

const TRIMMED_EXCERPT = 300;

/**
 * Shrink a conversation to fit maxPrompt tokens by cutting tool results down to a short
 * excerpt, oldest first. Roles and tool_call ids stay as they are. Returns the input itself
 * if it already fits, or null if it can't fit even fully trimmed.
 */
export function fitMessages(
  system: string,
  messages: ChatMessage[],
  tools: ToolDef[] | undefined,
  maxPrompt: number
): ChatMessage[] | null {
  if (estimatePromptTokens(system, messages, tools) <= maxPrompt) return messages;
  const out = messages.map((m) => ({ ...m })) as ChatMessage[];
  for (const m of out) {
    if (m.role !== "tool" || m.content.length <= TRIMMED_EXCERPT) continue;
    m.content = `${m.content.slice(0, TRIMMED_EXCERPT)}… [trimmed ${m.content.length - TRIMMED_EXCERPT} chars to fit the budget]`;
    if (estimatePromptTokens(system, out, tools) <= maxPrompt) return out;
  }
  return null;
}

// Thinking tokens allowed per turn, by effort. Without a cap a turn can be spent
// entirely on reasoning and end with no answer and no tool call.
export const REASONING_CAP = { low: 1_024, medium: 2_048, high: 4_096 } as const;

export function buildChatBody(
  opts: {
    system: string;
    messages: ChatMessage[];
    tools?: ToolDef[];
    effort?: "low" | "medium" | "high";
    toolChoice?: "auto" | "none";
  },
  model: string,
  maxTokens: number
) {
  return {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
    ...(opts.tools?.length
      ? {
          tools: opts.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          })),
          ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
        }
      : {}),
    // Keep at least half of the reply for the answer itself.
    reasoning: { max_tokens: Math.min(REASONING_CAP[opts.effort ?? "medium"], Math.floor(maxTokens / 2)) },
    usage: { include: true },
  };
}

export async function chat(opts: {
  agent: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  effort?: "low" | "medium" | "high";
  model?: string;
  maxTokens?: number;
  /** "none": tools stay declared (history may hold tool calls) but the model must answer in text. */
  toolChoice?: "auto" | "none";
}): Promise<ChatResult> {
  const model = opts.model ?? config.model;
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set (see .env.example)");

  const spent = inferenceSpentCents();
  if (spent >= config.llmBudgetCents) {
    throw new Error(
      `LLM budget reached: ~$${(spent / 100).toFixed(2)} spent of $${(config.llmBudgetCents / 100).toFixed(2)} (LLM_BUDGET_CENTS)`
    );
  }

  // Per-run token budget: estimate the prompt conservatively (~3 chars/token)
  // and cap the reply so the call can't overshoot what this agent has left.
  const left = tokensLeft(opts.agent);
  const estPrompt = estimatePromptTokens(opts.system, opts.messages, opts.tools);
  if (left - estPrompt < MIN_REPLY_TOKENS) {
    throw new TokenBudgetExceeded(
      `${opts.agent} is out of tokens for this run (share ${agentAllowance(opts.agent)}, ~${Math.max(0, left)} left, next call needs ~${estPrompt + MIN_REPLY_TOKENS})`
    );
  }
  const maxTokens = Math.min(opts.maxTokens ?? config.maxTokens, left - estPrompt);

  return withSpan(`llm:${opts.agent}`, { agent: opts.agent, model }, async (span) => {
    const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openrouterApiKey}`,
        "Content-Type": "application/json",
        "X-Title": "AutoShelf",
      },
      body: JSON.stringify(buildChatBody(opts, model, maxTokens)),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || body.error) {
      throw new Error(`OpenRouter ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
    }

    const choice = body.choices?.[0];
    const msg = choice?.message ?? {};
    const reasoningParts: string[] = msg.reasoning ? [String(msg.reasoning)] : [];
    const text = String(msg.content ?? "")
      .replace(THINK_TAG, (_: string, inner: string) => {
        reasoningParts.push(inner.trim());
        return "";
      })
      .trim();
    const toolCalls: ToolCall[] = msg.tool_calls ?? [];
    const toolUses: ToolUse[] = toolCalls.map((t) => ({
      id: t.id,
      name: t.function.name,
      input: parseArgs(t.function.arguments),
    }));
    const reasoning = reasoningParts.filter(Boolean).join("\n\n");
    const inTokens = body.usage?.prompt_tokens ?? 0;
    const outTokens = body.usage?.completion_tokens ?? 0;
    const costCents = (body.usage?.cost ?? 0) * 100;
    chargeTokens(opts.agent, inTokens + outTokens);
    const usedModel = body.model ?? model;

    // neatlogs LLM attributes (same keys its provider wrappers use).
    const attrs: Record<string, string | number | undefined> = {
      "neatlogs.llm.provider": "openrouter",
      "neatlogs.llm.system": usedModel.split("/")[0],
      "neatlogs.llm.model_name": usedModel,
      "neatlogs.llm.max_tokens": maxTokens,
      "neatlogs.llm.input_messages.0.role": "system",
      "neatlogs.llm.input_messages.0.content": opts.system,
      "neatlogs.llm.output_messages.0.role": "assistant",
      "neatlogs.llm.output_messages.0.content": text,
      "neatlogs.llm.output_messages.0.thinking": reasoning || undefined,
      "neatlogs.llm.token_count.prompt": inTokens,
      "neatlogs.llm.token_count.completion": outTokens,
      "neatlogs.llm.token_count.total": inTokens + outTokens,
      "neatlogs.llm.token_count.reasoning": body.usage?.completion_tokens_details?.reasoning_tokens,
      "neatlogs.llm.cost_usd": body.usage?.cost,
      "autoshelf.run_tokens_left": Number.isFinite(left) ? left - inTokens - outTokens : undefined,
      "neatlogs.llm.finish_reason": choice?.finish_reason,
      "output.value": text || toolUses.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join("\n"),
    };
    opts.messages.forEach((m, i) => {
      attrs[`neatlogs.llm.input_messages.${i + 1}.role`] = m.role;
      attrs[`neatlogs.llm.input_messages.${i + 1}.content`] = messageText(m);
    });
    toolUses.forEach((t, j) => {
      attrs[`neatlogs.llm.tool_calls.${j}.id`] = t.id;
      attrs[`neatlogs.llm.tool_calls.${j}.name`] = t.name;
      attrs[`neatlogs.llm.tool_calls.${j}.arguments`] = JSON.stringify(t.input);
    });
    span.set(attrs);

    return {
      model: usedModel,
      text,
      reasoning,
      toolUses,
      message: {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        // Send reasoning back with tool calls so the model keeps its chain of thought.
        ...(msg.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}),
      },
      stopReason: choice?.finish_reason ?? "",
      inTokens,
      outTokens,
      costCents,
    };
  });
}
