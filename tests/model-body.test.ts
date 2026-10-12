import { describe, it, expect } from "vitest";
import { buildChatBody, REASONING_CAP } from "../src/core/model.js";

const base = { system: "s", messages: [{ role: "user" as const, content: "hi" }] };

describe("buildChatBody reasoning cap", () => {
  // trace c76fe80a: Content (effort low) spent a whole 4096-token reply on 16.9k chars of thinking.
  // A max_tokens cap didn't stop it: deepseek-v4.1-flash ignores it (measured 2026-10-12: cap 300 → 1797
  // reasoning tokens; check-in 3 Content: cap 1024 → ~3.3k). Only `enabled: false` is honored (0 tokens).
  it("regression: low effort turns reasoning off, since a cap isn't enforced", () => {
    expect(buildChatBody({ ...base, effort: "low" }, "m", 4_096).reasoning).toEqual({ enabled: false });
  });
  it("uses a bigger cap for higher effort", () => {
    expect(REASONING_CAP.medium).toBeLessThan(REASONING_CAP.high);
    expect(buildChatBody({ ...base, effort: "medium" }, "m", 8_000).reasoning).toEqual({ max_tokens: REASONING_CAP.medium });
  });
  it("keeps at least half of a small reply for the answer", () => {
    expect(buildChatBody({ ...base, effort: "high" }, "m", 1_200).reasoning).toEqual({ max_tokens: 600 });
  });
  it("sends tool_choice only with tools", () => {
    const tools = [{ name: "t", description: "d", input_schema: { type: "object" as const, properties: {} } }];
    expect(buildChatBody({ ...base, tools, toolChoice: "none" }, "m", 2_000).tool_choice).toBe("none");
    expect(buildChatBody({ ...base, toolChoice: "none" }, "m", 2_000).tool_choice).toBeUndefined();
  });
});
