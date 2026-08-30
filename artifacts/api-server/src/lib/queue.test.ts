import { describe, expect, it } from "vitest";
import { enqueue, queueStats } from "./queue";

describe("tenant-scoped queue stats", () => {
  it("does not expose another tenant's pending event count", () => {
    expect(enqueue({ event: "tenant one", tenantId: 101, enqueuedAt: 1, source: "api" })).toBe(true);
    expect(enqueue({ event: "tenant two", tenantId: 202, enqueuedAt: 2, source: "api" })).toBe(true);

    expect(queueStats(101).pending).toBe(1);
    expect(queueStats(202).pending).toBe(1);
    expect(queueStats(303).pending).toBe(0);
  });
});