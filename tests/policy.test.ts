import { describe, it, expect, beforeEach } from "vitest";
import { check, resetPolicyBlockCount, getPolicyBlockCount } from "../src/services/policy.js";

describe("policy", () => {
  beforeEach(() => {
    resetPolicyBlockCount();
  });

  describe("set_price", () => {
    it("allows price with sufficient margin", () => {
      const result = check({
        type: "set_price",
        productId: "prod_1",
        newPriceCents: 1900,
        costCentsEst: 0,
        simDay: 1,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks price below margin floor", () => {
      const result = check({
        type: "set_price",
        productId: "prod_1",
        newPriceCents: 1000,
        costCentsEst: 900, // 10% margin, below 20% floor
        simDay: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("margin");
      expect(getPolicyBlockCount()).toBe(1);
    });
  });

  describe("apply_discount", () => {
    it("allows discount within limit", () => {
      const result = check({
        type: "apply_discount",
        productId: "prod_1",
        discountPct: 20,
        priceCents: 1900,
        costCentsEst: 0,
        simDay: 1,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks discount exceeding max", () => {
      const result = check({
        type: "apply_discount",
        productId: "prod_1",
        discountPct: 50,
        priceCents: 1900,
        costCentsEst: 0,
        simDay: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("discount");
    });

    it("blocks discount that drives negative margin", () => {
      const result = check({
        type: "apply_discount",
        productId: "prod_1",
        discountPct: 30,
        priceCents: 1000,
        costCentsEst: 800, // after 30% discount: 700 < 800 cost
        simDay: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("negative");
    });
  });

  describe("publish_listing", () => {
    it("allows listing with verified claims", () => {
      const result = check({
        type: "publish_listing",
        productId: "prod_1",
        claimsVerified: true,
        simDay: 1,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks listing with unverified claims", () => {
      const result = check({
        type: "publish_listing",
        productId: "prod_1",
        claimsVerified: false,
        simDay: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("unverified");
    });
  });

  describe("propose_refund", () => {
    it("allows small refund within auto-approve limit", () => {
      const result = check({
        type: "propose_refund",
        orderId: "order_1",
        amountCents: 1000,
        simDay: 1,
      });
      expect(result.allowed).toBe(true);
    });

    it("blocks large refund above auto-approve limit", () => {
      const result = check({
        type: "propose_refund",
        orderId: "order_1",
        amountCents: 5000, // above 2000 limit
        simDay: 1,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("approval");
    });
  });

  describe("policy block counter", () => {
    it("increments on each block", () => {
      check({ type: "publish_listing", productId: "p", claimsVerified: false, simDay: 1 });
      check({ type: "publish_listing", productId: "p", claimsVerified: false, simDay: 1 });
      expect(getPolicyBlockCount()).toBe(2);
    });

    it("resets correctly", () => {
      check({ type: "publish_listing", productId: "p", claimsVerified: false, simDay: 1 });
      resetPolicyBlockCount();
      expect(getPolicyBlockCount()).toBe(0);
    });
  });
});
