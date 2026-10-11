// Neatlogs wrapper — falls back to console if NEATLOGS_API_KEY is absent.
// Every span must be started and ended; use withSpan for automatic cleanup.

export interface Span {
  id: string;
  name: string;
  parentId?: string;
  tags: Record<string, string | number | boolean>;
  startedAt: number;
}

type SpanCallback<T> = (span: Span) => Promise<T>;

const apiKey = process.env["NEATLOGS_API_KEY"];
const endpoint = "https://api.neatlogs.com/v1/spans"; // stub — replace with real SDK when available

let _rootSpan: Span | null = null;

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function flushSpan(span: Span, durationMs: number, error?: string) {
  if (!apiKey) {
    // Offline / MOCK_LLM mode — just log to console
    const prefix = span.parentId ? "  " : "";
    console.log(
      `${prefix}[trace] ${span.name} ${durationMs}ms`,
      error ? `ERROR: ${error}` : "",
      Object.keys(span.tags).length ? span.tags : ""
    );
    return;
  }
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        id: span.id,
        name: span.name,
        parent_id: span.parentId,
        tags: span.tags,
        started_at: span.startedAt,
        duration_ms: durationMs,
        error,
      }),
    });
  } catch {
    // Never throw from tracing
  }
}

export function startRootSpan(
  name: string,
  tags: Record<string, string | number | boolean> = {}
): Span {
  _rootSpan = { id: makeId(), name, tags, startedAt: Date.now() };
  return _rootSpan;
}

export function getRootSpan(): Span | null {
  return _rootSpan;
}

export function startSpan(
  name: string,
  tags: Record<string, string | number | boolean> = {},
  parentId?: string
): Span {
  return {
    id: makeId(),
    name,
    tags,
    parentId: parentId ?? _rootSpan?.id,
    startedAt: Date.now(),
  };
}

export async function endSpan(span: Span, error?: string): Promise<void> {
  const durationMs = Date.now() - span.startedAt;
  await flushSpan(span, durationMs, error);
}

export async function withSpan<T>(
  name: string,
  tags: Record<string, string | number | boolean>,
  fn: SpanCallback<T>,
  parentId?: string
): Promise<T> {
  const span = startSpan(name, tags, parentId);
  try {
    const result = await fn(span);
    await endSpan(span);
    return result;
  } catch (err) {
    await endSpan(span, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
