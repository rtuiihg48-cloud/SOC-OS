import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export const CYBER_RANGE_CUBE_COUNT = 100;
export const CYBER_RANGE_SCENARIOS = [
  "MESI_COHERENCE",
  "NUMA_LATENCY",
  "PIPELINE_STALL",
  "SCHEDULER_PRESSURE",
  "QUARANTINE_PROPAGATION",
] as const;
export type CyberRangeScenario = (typeof CYBER_RANGE_SCENARIOS)[number];

type CubeStatus = "IDLE" | "RUNNING" | "PAUSED" | "SUCCESS" | "ISOLATED" | "FAILED";
type RangeStatus = "READY" | "RUNNING" | "PAUSED" | "COMPLETED";

type Cube = {
  id: string;
  index: number;
  status: CubeStatus;
  scenario: CyberRangeScenario;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  cycles: number;
  cores: number;
  numaNodes: number;
  cacheState: "M" | "E" | "S" | "I" | null;
  cacheHitRate: number | null;
  numaLatencyNs: number | null;
  event: string | null;
  error: string | null;
};

type Range = {
  tenantId: number;
  rangeId: string;
  status: RangeStatus;
  scenario: CyberRangeScenario;
  createdAt: string;
  updatedAt: string;
  runGeneration: number;
  nextCubeIndex: number;
  activeWorkers: Set<ChildProcess>;
  cubes: Cube[];
};

export type CyberRangeSnapshot = {
  rangeId: string;
  status: RangeStatus;
  scenario: CyberRangeScenario;
  createdAt: string;
  updatedAt: string;
  arbitraryExecutionDisabled: true;
  isolationBoundary: "TRUSTED_FIXED_CODE_PROCESS";
  coordination: "INSTANCE_LOCAL_VOLATILE";
  totalCubes: number;
  activeProcessWorkers: number;
  runningCubes: number;
  successCubes: number;
  isolatedCubes: number;
  failedCubes: number;
  completedCubes: number;
  cubes: Array<Omit<Cube, "index"> & { index: number }>;
};

type WorkerResult = {
  status: "SUCCESS" | "ISOLATED" | "FAILED";
  durationMs: number;
  cycles: number;
  cores: number;
  numaNodes: number;
  cacheState: "M" | "E" | "S" | "I";
  cacheHitRate: number;
  numaLatencyNs: number;
  event: string;
};

const workerSource = `
const input = JSON.parse(process.argv[1] || "{}");
const cube = Number(input.cubeIndex);
const scenario = String(input.scenario);
const durations = {
  MESI_COHERENCE: 90,
  NUMA_LATENCY: 120,
  PIPELINE_STALL: 150,
  SCHEDULER_PRESSURE: 180,
  QUARANTINE_PROPAGATION: 210
};
const durationMs = (durations[scenario] || 100) + (cube % 7) * 12;
const outcomes = {
  MESI_COHERENCE: cube % 17 === 0 ? "ISOLATED" : "SUCCESS",
  NUMA_LATENCY: cube % 19 === 0 ? "FAILED" : "SUCCESS",
  PIPELINE_STALL: cube % 23 === 0 ? "ISOLATED" : "SUCCESS",
  SCHEDULER_PRESSURE: cube % 29 === 0 ? "FAILED" : "SUCCESS",
  QUARANTINE_PROPAGATION: cube % 5 === 0 ? "ISOLATED" : "SUCCESS"
};
const events = {
  MESI_COHERENCE: "cache-coherence-observation",
  NUMA_LATENCY: "numa-latency-observation",
  PIPELINE_STALL: "pipeline-stall-observation",
  SCHEDULER_PRESSURE: "scheduler-pressure-observation",
  QUARANTINE_PROPAGATION: "quarantine-boundary-observation"
};
setTimeout(() => {
  const result = {
    status: outcomes[scenario] || "FAILED",
    durationMs,
    cycles: 120 + cube * 13 + durationMs,
    cores: 2 + (cube % 6),
    numaNodes: 2 + (cube % 3),
    cacheState: ["M", "E", "S", "I"][cube % 4],
    cacheHitRate: Number((0.72 + (cube % 20) / 100).toFixed(2)),
    numaLatencyNs: 80 + (cube % 11) * 7,
    event: events[scenario] || "unsupported-scenario"
  };
  process.stdout.write(JSON.stringify(result));
}, durationMs);
`;

function createCube(index: number, scenario: CyberRangeScenario): Cube {
  return {
    id: `CUBE-${String(index + 1).padStart(3, "0")}`,
    index,
    status: "IDLE",
    scenario,
    progress: 0,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    cycles: 0,
    cores: 0,
    numaNodes: 0,
    cacheState: null,
    cacheHitRate: null,
    numaLatencyNs: null,
    event: null,
    error: null,
  };
}

function now(): string {
  return new Date().toISOString();
}

export class CyberRangeManager {
  private readonly ranges = new Map<number, Range>();
  private readonly perRangeConcurrency = 8;
  private readonly maxActiveWorkers = 8;
  private activeWorkerCount = 0;
  private readonly admissionQueue: Array<() => void> = [];

  private getOrCreate(tenantId: number): Range {
    const existing = this.ranges.get(tenantId);
    if (existing) return existing;
    const scenario: CyberRangeScenario = "MESI_COHERENCE";
    const range: Range = {
      tenantId,
      rangeId: randomUUID(),
      status: "READY",
      scenario,
      createdAt: now(),
      updatedAt: now(),
      runGeneration: 0,
      nextCubeIndex: 0,
      activeWorkers: new Set(),
      cubes: Array.from({ length: CYBER_RANGE_CUBE_COUNT }, (_, index) => createCube(index, scenario)),
    };
    this.ranges.set(tenantId, range);
    return range;
  }

  snapshot(tenantId: number): CyberRangeSnapshot {
    const range = this.getOrCreate(tenantId);
    const current = Date.now();
    const cubes = range.cubes.map((cube) => {
      if (cube.status !== "RUNNING" || !cube.startedAt || !cube.durationMs) return { ...cube };
      const elapsed = current - Date.parse(cube.startedAt);
      return { ...cube, progress: Math.min(97, Math.max(3, Math.floor((elapsed / cube.durationMs) * 100))) };
    });
    return {
      rangeId: range.rangeId,
      status: range.status,
      scenario: range.scenario,
      createdAt: range.createdAt,
      updatedAt: range.updatedAt,
      arbitraryExecutionDisabled: true,
      isolationBoundary: "TRUSTED_FIXED_CODE_PROCESS",
      coordination: "INSTANCE_LOCAL_VOLATILE",
      totalCubes: cubes.length,
      activeProcessWorkers: range.activeWorkers.size,
      runningCubes: cubes.filter((cube) => cube.status === "RUNNING").length,
      successCubes: cubes.filter((cube) => cube.status === "SUCCESS").length,
      isolatedCubes: cubes.filter((cube) => cube.status === "ISOLATED").length,
      failedCubes: cubes.filter((cube) => cube.status === "FAILED").length,
      completedCubes: cubes.filter((cube) => ["SUCCESS", "ISOLATED", "FAILED"].includes(cube.status)).length,
      cubes,
    };
  }

  start(tenantId: number, scenario: CyberRangeScenario): CyberRangeSnapshot {
    const range = this.getOrCreate(tenantId);
    if (range.status === "RUNNING") return this.snapshot(tenantId);
    this.stopWorkers(range);
    range.rangeId = randomUUID();
    range.status = "RUNNING";
    range.scenario = scenario;
    range.createdAt = now();
    range.updatedAt = range.createdAt;
    range.runGeneration += 1;
    range.nextCubeIndex = 0;
    range.cubes = Array.from({ length: CYBER_RANGE_CUBE_COUNT }, (_, index) => createCube(index, scenario));
    const generation = range.runGeneration;
    void this.runRange(range, generation);
    return this.snapshot(tenantId);
  }

  pause(tenantId: number): CyberRangeSnapshot {
    const range = this.getOrCreate(tenantId);
    if (range.status === "RUNNING") {
      range.runGeneration += 1;
      this.stopWorkers(range);
      range.cubes = range.cubes.map((cube) => cube.status === "RUNNING" ? { ...cube, status: "PAUSED", progress: Math.min(cube.progress, 97) } : cube);
      range.status = "PAUSED";
      range.updatedAt = now();
    }
    return this.snapshot(tenantId);
  }

  reset(tenantId: number): CyberRangeSnapshot {
    const range = this.getOrCreate(tenantId);
    range.runGeneration += 1;
    this.stopWorkers(range);
    range.status = "READY";
    range.createdAt = now();
    range.updatedAt = range.createdAt;
    range.nextCubeIndex = 0;
    range.cubes = Array.from({ length: CYBER_RANGE_CUBE_COUNT }, (_, index) => createCube(index, range.scenario));
    return this.snapshot(tenantId);
  }

  stopAll(): void {
    for (const range of this.ranges.values()) {
      range.runGeneration += 1;
      this.stopWorkers(range);
      if (range.status === "RUNNING") range.status = "PAUSED";
      range.updatedAt = now();
    }
  }

  private stopWorkers(range: Range): void {
    for (const child of range.activeWorkers) child.kill("SIGKILL");
    range.activeWorkers.clear();
  }

  private async runRange(range: Range, generation: number): Promise<void> {
    const loops = Array.from({ length: this.perRangeConcurrency }, () => this.workerLoop(range, generation));
    await Promise.all(loops);
    if (range.runGeneration === generation && range.status === "RUNNING") {
      range.status = "COMPLETED";
      range.updatedAt = now();
    }
  }

  private async workerLoop(range: Range, generation: number): Promise<void> {
    while (range.runGeneration === generation && range.status === "RUNNING") {
      const cubeIndex = range.nextCubeIndex;
      range.nextCubeIndex += 1;
      if (cubeIndex >= range.cubes.length) return;
      await this.runCube(range, generation, cubeIndex);
    }
  }

  private async runCube(range: Range, generation: number, cubeIndex: number): Promise<void> {
    const cube = range.cubes[cubeIndex];
    if (!cube) return;
    const releaseAdmission = await this.acquireAdmission();
    if (range.runGeneration !== generation || range.status !== "RUNNING") {
      releaseAdmission();
      return;
    }
    const startedAt = now();
    const durationMs = 90 + (cubeIndex % 7) * 12;
    range.cubes[cubeIndex] = { ...cube, status: "RUNNING", progress: 3, startedAt, durationMs, error: null };
    const child = spawn(process.execPath, ["-e", workerSource, JSON.stringify({ cubeIndex, scenario: range.scenario })], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
    });
    range.activeWorkers.add(child);
    try {
      const result = await new Promise<WorkerResult>((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("worker timeout"));
        }, 3000);
        child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
        child.once("error", reject);
        child.once("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(`worker exited with code ${code ?? "unknown"}`));
            return;
          }
          try { resolve(JSON.parse(output) as WorkerResult); } catch { reject(new Error("invalid worker telemetry")); }
        });
      });
      if (range.runGeneration !== generation || range.status !== "RUNNING") return;
      range.cubes[cubeIndex] = {
        ...range.cubes[cubeIndex],
        ...result,
        status: result.status,
        progress: 100,
        completedAt: now(),
        error: null,
      };
    } catch (error) {
      if (range.runGeneration === generation && range.status === "RUNNING") {
        range.cubes[cubeIndex] = { ...range.cubes[cubeIndex], status: "FAILED", progress: 100, completedAt: now(), error: error instanceof Error ? error.message : "worker failed" };
      }
    } finally {
      range.activeWorkers.delete(child);
      range.updatedAt = now();
      releaseAdmission();
    }
  }

  private async acquireAdmission(): Promise<() => void> {
    if (this.activeWorkerCount >= this.maxActiveWorkers) {
      await new Promise<void>((resolve) => this.admissionQueue.push(resolve));
    }
    this.activeWorkerCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeWorkerCount -= 1;
      this.admissionQueue.shift()?.();
    };
  }
}

export const cyberRangeManager = new CyberRangeManager();