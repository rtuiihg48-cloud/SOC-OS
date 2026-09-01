import { describe, expect, it } from "vitest";
import { decideSecurityTestQuota, freeSecurityTestLimit } from "./security-test-quota";

describe("security-test quota decisions", () => {
  it("allows precisely the configured free-test limit", () => {
    expect(decideSecurityTestQuota(false, 0, 3)).toMatchObject({ allowed: true, freeUsed: 0, freeRemaining: 3 });
    expect(decideSecurityTestQuota(false, 2, 3)).toMatchObject({ allowed: true, freeUsed: 2, freeRemaining: 1 });
    expect(decideSecurityTestQuota(false, 3, 3)).toMatchObject({ allowed: false, freeUsed: 3, freeRemaining: 0 });
  });

  it("allows paid access independently of free usage", () => {
    expect(decideSecurityTestQuota(true, 3, 3)).toMatchObject({ allowed: true, paidAccess: true, freeRemaining: 0 });
  });

  it("rejects invalid configuration rather than silently changing access", () => {
    expect(() => freeSecurityTestLimit("-1")).toThrow("non-negative integer");
    expect(() => freeSecurityTestLimit("three")).toThrow("non-negative integer");
  });
});