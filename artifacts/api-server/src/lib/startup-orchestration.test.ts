import { describe, expect, it } from "vitest";
import { assertBiosStartupAllowed, bindAfterBios } from "./startup-orchestration";
import type { HckBiosStatus } from "./hck-bios";

const failedBios: HckBiosStatus = {
  name: "HCK-BIOS",
  modelVersion: "hck-bios-v1",
  status: "failed",
  bootedAt: "2026-09-01T00:00:00.000Z",
  productionMutationsAllowed: false,
  executionPlane: "isolated",
  capabilities: [],
  topology: { logicalCpuCount: 1, totalMemoryMb: 1, platform: "test" },
  stages: [],
};

describe("startup BIOS gate", () => {
  it("blocks production binding after a failed BIOS without needing a server port", () => {
    expect(() => assertBiosStartupAllowed(failedBios, true)).toThrow("HCK-BIOS failed during production startup");
  });

  it("keeps failed BIOS diagnostics available during development", () => {
    expect(() => assertBiosStartupAllowed(failedBios, false)).not.toThrow();
  });

  it("does not bind or start the scheduler after production BIOS failure", () => {
    let bound = false;
    let schedulerStarted = false;
    expect(() => bindAfterBios(failedBios, true, () => { bound = true; }, () => { schedulerStarted = true; }))
      .toThrow("HCK-BIOS failed during production startup");
    expect(bound).toBe(false);
    expect(schedulerStarted).toBe(false);
  });

  it("starts the scheduler only from the successful bind callback", () => {
    let schedulerStarted = false;
    bindAfterBios({ ...failedBios, status: "ready" }, true, (onListening) => {
      expect(schedulerStarted).toBe(false);
      onListening();
    }, () => { schedulerStarted = true; });
    expect(schedulerStarted).toBe(true);
  });
});