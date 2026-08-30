import os from "node:os";

export type BootStageStatus = "ready" | "degraded" | "failed";
export type HckBootStatus = "offline" | "booting" | "ready" | "degraded" | "failed";

export interface BootStage {
  name: string;
  status: BootStageStatus;
  detail: string;
  checkedAt: string;
  durationMs: number;
  data?: Record<string, unknown>;
}

export interface HckBiosStatus {
  name: "HCK-BIOS";
  modelVersion: "hck-bios-v1";
  status: HckBootStatus;
  bootedAt: string | null;
  productionMutationsAllowed: false;
  executionPlane: "isolated";
  capabilities: Array<{
    name: string;
    mode: "read-only";
    source: string;
  }>;
  topology: {
    logicalCpuCount: number;
    totalMemoryMb: number;
    platform: string;
  };
  stages: BootStage[];
}

export interface HckBiosDependencies {
  checkDatabase(): Promise<Record<string, unknown>>;
  checkSchema(): Promise<{ missing: string[] }>;
  checkMetaCube(): Promise<Record<string, unknown>>;
  getQueueStatus(): Record<string, unknown>;
}

const REQUIRED_TABLES = [
  "tenants",
  "security_events",
  "dna_predictions",
  "dna_outcomes",
  "dna_attack_links",
  "dna_prediction_layer_observations",
  "agent_observer_runs",
  "sandbox_quarantines",
];

const CAPABILITIES: HckBiosStatus["capabilities"] = [
  { name: "observe.event", mode: "read-only", source: "SOC rule analyzer" },
  { name: "observe.system_metrics", mode: "read-only", source: "host metrics" },
  { name: "observe.dna_memory", mode: "read-only", source: "PostgreSQL aggregates" },
  { name: "observe.meta_cube_health", mode: "read-only", source: "META-CUBE health bridge" },
];

let status: HckBiosStatus = {
  name: "HCK-BIOS",
  modelVersion: "hck-bios-v1",
  status: "offline",
  bootedAt: null,
  productionMutationsAllowed: false,
  executionPlane: "isolated",
  capabilities: CAPABILITIES,
  topology: {
    logicalCpuCount: os.cpus().length,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    platform: os.platform(),
  },
  stages: [],
};

let bootPromise: Promise<HckBiosStatus> | null = null;

function snapshot(): HckBiosStatus {
  return JSON.parse(JSON.stringify(status)) as HckBiosStatus;
}

async function runStage(
  name: string,
  check: () => Promise<{ status?: BootStageStatus; detail: string; data?: Record<string, unknown> }>,
): Promise<BootStage> {
  const startedAt = performance.now();
  try {
    const result = await check();
    return {
      name,
      status: result.status ?? "ready",
      detail: result.detail,
      checkedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      data: result.data,
    };
  } catch (error) {
    return {
      name,
      status: "failed",
      detail: error instanceof Error ? error.message : "Boot check failed.",
      checkedAt: new Date().toISOString(),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
  }
}

export async function bootHckBios(dependencies: HckBiosDependencies): Promise<HckBiosStatus> {
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    status = { ...status, status: "booting", stages: [] };

    const stages: BootStage[] = [];
    stages.push(await runStage("power_on", async () => ({
      detail: "Runtime configuration accepted.",
      data: { nodeEnv: process.env["NODE_ENV"] ?? "unknown" },
    })));
    stages.push(await runStage("database", async () => {
      const result = await dependencies.checkDatabase();
      return { detail: "PostgreSQL connection is available.", data: result };
    }));
    stages.push(await runStage("schema", async () => {
      const result = await dependencies.checkSchema();
      if (result.missing.length > 0) {
        return {
          status: "failed",
          detail: `Required tables missing: ${result.missing.join(", ")}`,
          data: { requiredTables: REQUIRED_TABLES, missingTables: result.missing },
        };
      }
      return {
        detail: "Required runtime and memory tables are present.",
        data: { requiredTables: REQUIRED_TABLES, missingTables: [] },
      };
    }));
    stages.push(await runStage("isa_security", async () => ({
      detail: "Allowlisted observer capabilities loaded; execution plane isolated.",
      data: {
        capabilityCount: CAPABILITIES.length,
        forbidden: ["shell", "network_scan", "production_mutation", "self_modifying_code"],
      },
    })));
    stages.push(await runStage("host_cores", async () => ({
      detail: "Real host topology detected; no virtual cores were created.",
      data: {
        logicalCpuCount: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        platform: os.platform(),
      },
    })));
    stages.push(await runStage("meta_cube", async () => {
      const result = await dependencies.checkMetaCube();
      const degraded = result.status !== "ok";
      return {
        status: degraded ? "degraded" : "ready",
        detail: degraded ? "META-CUBE responded but is not fully healthy." : "META-CUBE health check passed.",
        data: result,
      };
    }));
    stages.push(await runStage("scheduler", async () => {
      const queue = dependencies.getQueueStatus();
      if (queue["hasProcessor"] !== true) {
        return { status: "degraded", detail: "Queue processor is not registered yet.", data: queue };
      }
      return { detail: "Event queue processor is registered.", data: queue };
    }));

    const hasFailed = stages.some((stage) => stage.status === "failed");
    const hasDegraded = stages.some((stage) => stage.status === "degraded");
    status = {
      ...status,
      status: hasFailed ? "failed" : hasDegraded ? "degraded" : "ready",
      bootedAt: new Date().toISOString(),
      stages,
      topology: {
        logicalCpuCount: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        platform: os.platform(),
      },
    };
    return snapshot();
  })();

  try {
    return await bootPromise;
  } catch (error) {
    status = {
      ...status,
      status: "failed",
      bootedAt: new Date().toISOString(),
      stages: [{
        name: "boot",
        status: "failed",
        detail: error instanceof Error ? error.message : "HCK-BIOS boot failed.",
        checkedAt: new Date().toISOString(),
        durationMs: 0,
      }],
    };
    throw error;
  }
}

export function getHckBiosStatus(): HckBiosStatus {
  return snapshot();
}

export function getRequiredHckTables(): readonly string[] {
  return REQUIRED_TABLES;
}