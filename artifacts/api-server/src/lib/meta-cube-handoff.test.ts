import { describe, expect, it, vi } from "vitest";
import { auditedHandoff, validatedIdempotencyKey } from "./meta-cube-handoff";

describe("META-CUBE handoff audit ordering", () => {
  it("rejects missing idempotency before a handoff can be attempted", () => {
    expect(validatedIdempotencyKey(undefined, undefined)).toBeNull();
  });

  it("records FAILED but never QUEUED when upstream rejects the handoff", async () => {
    const decisions: string[] = [];
    await expect(auditedHandoff(
      async () => { throw new Error("upstream unavailable"); },
      async () => { decisions.push("META_CUBE_REQUEST_QUEUED"); },
      async () => { decisions.push("META_CUBE_REQUEST_FAILED"); },
    )).rejects.toThrow("upstream unavailable");
    expect(decisions).toEqual(["META_CUBE_REQUEST_FAILED"]);
    expect(decisions).not.toContain("META_CUBE_REQUEST_QUEUED");
  });

  it("records accepted evidence only after the upstream result exists", async () => {
    const order: string[] = [];
    const result = await auditedHandoff(
      async () => { order.push("upstream"); return { id: "execution-1" }; },
      async ({ id }) => { order.push(`queued:${id}`); },
      vi.fn(),
    );
    expect(result.id).toBe("execution-1");
    expect(order).toEqual(["upstream", "queued:execution-1"]);
  });
});