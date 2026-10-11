// Tracing via the neatlogs SDK. Each check-in is a WORKFLOW trace; agents, model
// calls and tools nest inside it as AGENT, LLM and TOOL spans, so neatlogs shows
// the whole tree with each model call's thinking. Without NEATLOGS_API_KEY,
// spans are printed to the console instead.

import { init, shutdown, trace } from "neatlogs";

export type SpanKind = "WORKFLOW" | "AGENT" | "LLM" | "TOOL" | "CHAIN";
type Attr = string | number | boolean;

export interface Span {
  id: string;
  /** neatlogs/OpenTelemetry trace id (empty without neatlogs). */
  traceId: string;
  name: string;
  tags: Record<string, Attr>;
  startedAt: number;
  /** Attach attributes to the span (no-op without neatlogs). */
  set(attrs: Record<string, Attr | undefined>): void;
}

const apiKey = process.env["NEATLOGS_API_KEY"];
let ready: Promise<void> | null = null;

/**
 * Start the neatlogs SDK once per process, at the entry point's startup.
 * workflowName names what this process does (e.g. "agent-check-in").
 */
export function initTracing(workflowName: string): Promise<void> {
  if (!apiKey) return Promise.resolve();
  return ensureInit(workflowName);
}

function ensureInit(workflowName = "agent-check-in"): Promise<void> {
  ready ??= init({
    apiKey,
    workflowName,
    ...(process.env["NEATLOGS_ENDPOINT"] ? { endpoint: process.env["NEATLOGS_ENDPOINT"] } : {}),
  }).catch((err) => {
    console.error("[trace] neatlogs init failed, tracing disabled:", err);
  });
  return ready;
}

function kindFor(name: string): SpanKind {
  if (name.startsWith("agent:")) return "AGENT";
  if (name.startsWith("llm:")) return "LLM";
  if (name.startsWith("tool:")) return "TOOL";
  if (name.startsWith("live:") || name.startsWith("sim:")) return "WORKFLOW";
  return "CHAIN";
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function withSpan<T>(
  name: string,
  tags: Record<string, Attr>,
  fn: (span: Span) => Promise<T>,
  _parentId?: string,
  kind: SpanKind = kindFor(name)
): Promise<T> {
  const startedAt = Date.now();

  if (!apiKey) {
    const span: Span = { id: makeId(), traceId: "", name, tags, startedAt, set: () => {} };
    try {
      const result = await fn(span);
      console.log(`[trace] ${name} ${Date.now() - startedAt}ms`, Object.keys(tags).length ? tags : "");
      return result;
    } catch (err) {
      console.log(`[trace] ${name} ${Date.now() - startedAt}ms ERROR: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  await ensureInit();
  // LLM spans carry their messages as attributes, so skip the generic input capture there.
  return trace({ name, kind, ...(kind === "LLM" ? {} : { input: tags }), attributes: tags }, async (otel) => {
    const span: Span = {
      id: otel.spanContext().spanId,
      traceId: otel.spanContext().traceId,
      name,
      tags,
      startedAt,
      set(attrs) {
        for (const [k, v] of Object.entries(attrs)) if (v !== undefined) otel.setAttribute(k, v);
      },
    };
    return fn(span);
  });
}

/** Send any buffered spans. Call before a short-lived script exits. */
export async function shutdownTracing(): Promise<void> {
  if (ready) {
    await ready;
    await shutdown();
  }
}
