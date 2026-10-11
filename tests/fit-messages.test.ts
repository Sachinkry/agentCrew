import { describe, it, expect } from "vitest";
import { fitMessages, estimatePromptTokens, type ChatMessage } from "../src/core/model.js";

const big = (n: number) => "x".repeat(n);
// Shape of check-in 15's second Analytics job: one batch of 5 tool results (sizes in chars from the trace).
const messages: ChatMessage[] = [
  { role: "user", content: "How is neatlogs positioned vs Langfuse?" },
  {
    role: "assistant",
    content: "Pulling data.",
    tool_calls: ["a", "b", "c", "d", "e"].map((id) => ({ id, type: "function" as const, function: { name: "t", arguments: "{}" } })),
  },
  { role: "tool", tool_call_id: "a", content: big(4_092) },
  { role: "tool", tool_call_id: "b", content: big(1_392) },
  { role: "tool", tool_call_id: "c", content: big(301) },
  { role: "tool", tool_call_id: "d", content: big(116) },
  { role: "tool", tool_call_id: "e", content: big(2_860) },
];
const system = big(3_000);

describe("fitMessages", () => {
  it("returns the messages unchanged when they already fit", () => {
    expect(fitMessages(system, messages, undefined, 100_000)).toBe(messages);
  });

  it("regression: trims tool results (oldest first) until the prompt fits", () => {
    const target = 3_000;
    expect(estimatePromptTokens(system, messages)).toBeGreaterThan(target);
    const fitted = fitMessages(system, messages, undefined, target)!;
    expect(estimatePromptTokens(system, fitted)).toBeLessThanOrEqual(target);
    // structure kept: same roles, same tool_call ids, the task untouched
    expect(fitted.map((m) => m.role)).toEqual(messages.map((m) => m.role));
    expect(fitted.filter((m) => m.role === "tool").map((m: any) => m.tool_call_id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(fitted[0]).toEqual(messages[0]);
    expect((fitted[2] as any).content).toMatch(/trimmed/);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(messages);
    fitMessages(system, messages, undefined, 3_000);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("returns null when even fully trimmed it can't fit", () => {
    expect(fitMessages(system, messages, undefined, 500)).toBeNull();
  });
});
