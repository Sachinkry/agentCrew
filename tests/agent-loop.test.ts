import { describe, it, expect } from "vitest";
import { missingArgs, nextStep } from "../src/core/agent.js";

const schema = {
  type: "object" as const,
  properties: { slug: { type: "string" }, verdicts: { type: "array" } },
  required: ["slug", "verdicts"],
};

describe("missingArgs", () => {
  it("is empty when every required field is present", () => {
    expect(missingArgs(schema, { slug: "neatlogs", verdicts: [] })).toEqual([]);
  });
  // check-in 10: mark_claims was called with only { slug } and crashed with "verdicts is not iterable"
  it("regression: names the field mark_claims was called without", () => {
    expect(missingArgs(schema, { slug: "neatlogs" })).toEqual(["verdicts"]);
  });
  it("treats null as missing", () => {
    expect(missingArgs(schema, { slug: "neatlogs", verdicts: null })).toEqual(["verdicts"]);
  });
  it("is empty when the schema has no required list", () => {
    expect(missingArgs({ type: "object", properties: {} }, {})).toEqual([]);
  });
});

describe("nextStep", () => {
  const call = [{ id: "1", name: "get_product", input: {} }];

  it("runs tools when the model called some", () => {
    expect(nextStep({ text: "", toolUses: call, stopReason: "tool_calls" }, { final: false, retried: false }))
      .toEqual({ do: "tools" });
  });
  it("returns the text when the model answered", () => {
    expect(nextStep({ text: "done", toolUses: [], stopReason: "stop" }, { final: false, retried: false }))
      .toEqual({ do: "return", text: "done" });
  });
  // check-in 14: Content's forced last turn had no tools, so it pasted a finished listing and blog
  // draft into its report instead of publishing them. The last turn may act once, then the loop ends.
  it("regression: runs the tools on a budget-final turn, then ends with the text", () => {
    expect(nextStep({ text: "report", toolUses: call, stopReason: "tool_calls" }, { final: true, retried: false }))
      .toEqual({ do: "tools-then-return", text: "report" });
  });
  it("ignores tool calls on the retry after an empty reply", () => {
    expect(nextStep({ text: "summary", toolUses: call, stopReason: "tool_calls" }, { final: true, retried: true }))
      .toEqual({ do: "return", text: "summary" });
  });
  // trace e77bde38: Content's last turn was all thinking, cut off, and "" went back to the operator
  it("regression: retries once when the reply is empty instead of returning an empty answer", () => {
    const s = nextStep({ text: "", toolUses: [], stopReason: "length" }, { final: false, retried: false });
    expect(s.do).toBe("retry");
    if (s.do === "retry") expect(s.note).toMatch(/cut off/);
  });
  it("gives up with a readable answer if the retry is empty too", () => {
    const s = nextStep({ text: "", toolUses: [], stopReason: "length" }, { final: true, retried: true });
    expect(s).toEqual({ do: "return", text: "No answer: the reply was cut off twice (stop reason: length)." });
  });
});
