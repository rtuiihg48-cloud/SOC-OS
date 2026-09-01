import { afterEach, describe, expect, it } from "vitest";
import { CyberRangeManager } from "./cyber-range";

const managers: CyberRangeManager[] = [];

function manager(): CyberRangeManager {
  const value = new CyberRangeManager();
  managers.push(value);
  return value;
}

async function waitForCompletion(value: CyberRangeManager, tenantId: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snapshot = value.snapshot(tenantId);
    if (snapshot.status === "COMPLETED") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("cyber range did not complete before the test deadline");
}

afterEach(() => {
  for (const value of managers.splice(0)) value.stopAll();
});

describe("CyberRangeManager", () => {
  it("creates exactly 100 idle tenant-scoped cubes", () => {
    const value = manager();
    const first = value.snapshot(1);
    const second = value.snapshot(2);

    expect(first.totalCubes).toBe(100);
    expect(first.cubes).toHaveLength(100);
    expect(first.cubes[0]?.id).toBe("CUBE-001");
    expect(first.cubes[99]?.id).toBe("CUBE-100");
    expect(first.cubes.every((cube) => cube.status === "IDLE")).toBe(true);
    expect(second.rangeId).not.toBe(first.rangeId);
  });

  it("runs deterministic allowlisted workloads in bounded process workers", async () => {
    const value = manager();
    const started = value.start(7, "NUMA_LATENCY");

    expect(started.status).toBe("RUNNING");
    expect(started.scenario).toBe("NUMA_LATENCY");

    const completed = await waitForCompletion(value, 7);
    expect(completed.completedCubes).toBe(100);
    expect(completed.runningCubes).toBe(0);
    expect(completed.successCubes + completed.isolatedCubes + completed.failedCubes).toBe(100);
    expect(completed.cubes.every((cube) => cube.progress === 100)).toBe(true);
    expect(completed.cubes.some((cube) => cube.numaLatencyNs !== null)).toBe(true);
    expect(completed.arbitraryExecutionDisabled).toBe(true);
    expect(completed.isolationBoundary).toBe("TRUSTED_FIXED_CODE_PROCESS");
    expect(completed.coordination).toBe("INSTANCE_LOCAL_VOLATILE");
  }, 15_000);

  it("terminates active workers when paused and returns all cubes to idle on reset", async () => {
    const value = manager();
    value.start(3, "QUARANTINE_PROPAGATION");
    await new Promise((resolve) => setTimeout(resolve, 40));

    const paused = value.pause(3);
    expect(paused.status).toBe("PAUSED");
    expect(paused.runningCubes).toBe(0);

    const reset = value.reset(3);
    expect(reset.status).toBe("READY");
    expect(reset.cubes.every((cube) => cube.status === "IDLE" && cube.progress === 0)).toBe(true);
  });

  it("does not lose replacement worker tracking during a rapid reset and restart", async () => {
    const value = manager();
    value.start(5, "PIPELINE_STALL");
    await new Promise((resolve) => setTimeout(resolve, 10));
    value.reset(5);
    value.start(5, "MESI_COHERENCE");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(value.snapshot(5).activeProcessWorkers).toBeGreaterThan(0);
    const paused = value.pause(5);
    expect(paused.activeProcessWorkers).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(value.snapshot(5).activeProcessWorkers).toBe(0);
  });
});