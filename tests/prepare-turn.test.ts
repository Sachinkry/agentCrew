import { describe, it, expect } from "vitest";
import { prepareTurn, FINAL_REPLY_TOKENS } from "../src/core/agent.js";
import { estimatePromptTokens, type ChatMessage } from "../src/core/model.js";

const big = (n: number) => "x".repeat(n);
const system = big(1_500);
const msgs: ChatMessage[] = [
  { role: "user", content: "task" },
  { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "t", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "a", content: big(12_000) },
];
const prompt = estimatePromptTokens(system, msgs);

describe("prepareTurn", () => {
  it("is a normal turn with the full history when there's room", () => {
    const t = prepareTurn({ left: 100_000, system, messages: msgs, replies: [300], retried: false });
    expect(t).toEqual({ final: false, messages: msgs });
  });
  it("is final (full history) when only one more turn fits", () => {
    const t = prepareTurn({ left: prompt + 2_000, system, messages: msgs, replies: [300], retried: false });
    expect(t.final).toBe(true);
    expect(t.messages).toBe(msgs);
  });
  // check-in 15: Analytics had ~4251 left and the next prompt needed ~5017, so it stopped with nothing
  it("regression: trims the history so a last turn still fits instead of stopping", () => {
    const left = prompt - 500;
    const t = prepareTurn({ left, system, messages: msgs, replies: [300], retried: false });
    expect(t.final).toBe(true);
    expect(t.messages).not.toBeNull();
    expect(estimatePromptTokens(system, t.messages!) + FINAL_REPLY_TOKENS).toBeLessThanOrEqual(left);
  });
  it("gives up (messages null) when nothing can fit", () => {
    expect(prepareTurn({ left: 100, system, messages: msgs, replies: [300], retried: false }).messages).toBeNull();
  });
  it("a retry is always final", () => {
    expect(prepareTurn({ left: 100_000, system, messages: msgs, replies: [300], retried: true }).final).toBe(true);
  });
});
