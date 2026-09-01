import { afterEach, describe, expect, it } from "vitest";
import { DispatchNodeClusterTaskBody } from "@workspace/api-zod";
import { validateNodeTaskBody } from "./node-task-validation";
import {
  NODE_CLUSTER_MAX_ACTIVE_TASKS,
  NODE_CLUSTER_SIZE,
  NodeClusterError,
  NodeClusterManager,
  type NodeTaskInput,
} from "./node-cluster";

const managers: NodeClusterManager[] = [];

function createManager(): NodeClusterManager {
  const manager = new NodeClusterManager();
  managers.push(manager);
  return manager;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition was not satisfied before the test deadline");
}

afterEach(() => {
  for (const manager of managers.splice(0)) manager.stopAll();
});

describe("NodeClusterManager", () => {
  it("creates ten tenant-scoped trusted process nodes", () => {
    const manager = createManager();
    const firstTenant = manager.snapshot(1);
    const secondTenant = manager.snapshot(2);

    expect(firstTenant.maxNodes).toBe(NODE_CLUSTER_SIZE);
    expect(firstTenant.nodes).toHaveLength(10);
    expect(firstTenant.nodes[0]?.nodeId).toBe("NODE-01");
    expect(firstTenant.nodes.every((node) =>
      node.runtime === "PROCESS" &&
      node.boundary === "TRUSTED_FIXED_CODE_PROCESS"
    )).toBe(true);
    expect(firstTenant.coordination).toBe("INSTANCE_LOCAL_VOLATILE");
    expect(secondTenant.messages).toHaveLength(0);
  });

  it("routes an allowlisted task by required capabilities and records relay transitions", async () => {
    const manager = createManager();
    const accepted = manager.dispatch(1, "corr-1", {
      kind: "SIMULATION",
      scenario: "NUMA_LATENCY",
      requiredCapabilities: ["NUMA", "TELEMETRY"],
      priority: "HIGH",
    });

    expect(accepted.destinationNodeId).toBeTruthy();
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.transitions.map((transition) => transition.status)).toEqual([
      "CREATED",
      "QUEUED",
      "ACCEPTED",
    ]);

    await waitUntil(() => manager.snapshot(1).completedTasks === 1);
    const completed = manager.listMessages(1)[0]!;
    expect(completed.status).toBe("EXECUTED");
    expect(completed.resultObservation).toBe("numa-latency-completed");
    expect(completed.relayAuthentication).toBe("ED25519_TASK_SIGNATURE");
    expect(completed.taskSignatureVerified).toBe(true);
    expect(manager.snapshot(2).messages).toHaveLength(0);
  });

  it("enforces one manager-wide active task limit across tenants", async () => {
    const manager = createManager();
    for (let index = 0; index < 8; index += 1) {
      manager.dispatch(index % 2 === 0 ? 1 : 2, `corr-${index}`, {
        kind: "OBSERVATION",
        scenario: null,
        requiredCapabilities: ["CPU", "TELEMETRY"],
      });
    }

    const active = manager.snapshot(1).activeTasks + manager.snapshot(2).activeTasks;
    const queued = manager.snapshot(1).queueDepth + manager.snapshot(2).queueDepth;
    expect(active).toBe(NODE_CLUSTER_MAX_ACTIVE_TASKS);
    expect(queued).toBe(4);

    await waitUntil(() =>
      manager.snapshot(1).completedTasks + manager.snapshot(2).completedTasks === 8
    );
    expect(manager.snapshot(1).activeTasks + manager.snapshot(2).activeTasks).toBe(0);
  });

  it("rejects unsupported task shapes before they reach the relay", () => {
    const manager = createManager();

    expect(() => manager.dispatch(1, "corr-invalid", {
      kind: "SIMULATION",
      requiredCapabilities: ["CPU"],
    } as unknown as NodeTaskInput)).toThrowError(NodeClusterError);

    expect(() => manager.dispatch(1, "corr-invalid", {
      kind: "OBSERVATION",
      scenario: "MESI_COHERENCE",
      requiredCapabilities: ["TELEMETRY"],
    } as unknown as NodeTaskInput)).toThrowError(NodeClusterError);
  });

  it("routes queued high-priority work ahead of earlier low-priority work across tenants", async () => {
    const manager = createManager();
    const requiredCapabilities = ["CPU", "MEMORY", "NUMA", "CACHE", "TELEMETRY"] as const;
    for (let index = 0; index < NODE_CLUSTER_MAX_ACTIVE_TASKS; index += 1) {
      manager.dispatch(1, `corr-active-${index}`, {
        kind: "OBSERVATION",
        scenario: null,
        requiredCapabilities: [...requiredCapabilities],
      });
    }
    const low = manager.dispatch(1, "corr-low", {
      kind: "OBSERVATION",
      scenario: null,
      requiredCapabilities: [...requiredCapabilities],
      priority: "LOW",
    });
    const high = manager.dispatch(2, "corr-high", {
      kind: "OBSERVATION",
      scenario: null,
      requiredCapabilities: [...requiredCapabilities],
      priority: "HIGH",
    });
    expect(low.status).toBe("QUEUED");
    expect(high.status).toBe("QUEUED");

    await waitUntil(() => {
      const highStatus = manager.listMessages(2).find((message) => message.taskId === high.taskId)?.status;
      return highStatus === "ACCEPTED" || highStatus === "EXECUTED";
    });
    expect(manager.listMessages(1).find((message) => message.taskId === low.taskId)?.status).toBe("QUEUED");
  });

  it("keeps generated request validation aligned with task-kind semantics", () => {
    expect(DispatchNodeClusterTaskBody.safeParse({
      kind: "SIMULATION",
      scenario: "NUMA_LATENCY",
      requiredCapabilities: ["NUMA"],
    }).success).toBe(true);
    expect(DispatchNodeClusterTaskBody.safeParse({
      kind: "SIMULATION",
      scenario: null,
      requiredCapabilities: ["NUMA"],
    }).success).toBe(false);
    expect(DispatchNodeClusterTaskBody.safeParse({
      kind: "OBSERVATION",
      scenario: null,
      requiredCapabilities: ["TELEMETRY"],
    }).success).toBe(true);
    expect(DispatchNodeClusterTaskBody.safeParse({
      kind: "OBSERVATION",
      scenario: "MESI_COHERENCE",
      requiredCapabilities: ["TELEMETRY"],
    }).success).toBe(false);
    expect(validateNodeTaskBody({
      kind: "OBSERVATION",
      scenario: null,
      requiredCapabilities: ["CPU"],
      arbitraryPayload: "rejected",
    }).success).toBe(false);
    expect(validateNodeTaskBody({
      kind: "OBSERVATION",
      scenario: null,
      requiredCapabilities: ["CPU", "CPU"],
    }).success).toBe(false);
  });

  it("cleans queued and active task ownership on shutdown", () => {
    const manager = createManager();
    for (let index = 0; index < 6; index += 1) {
      manager.dispatch(1, `corr-stop-${index}`, {
        kind: "OBSERVATION",
        scenario: null,
        requiredCapabilities: ["CPU"],
      });
    }

    manager.stopAll();
    const stopped = manager.snapshot(1);
    expect(stopped.activeTasks).toBe(0);
    expect(stopped.queueDepth).toBe(0);
    expect(stopped.nodes.every((node) =>
      node.activeTasks === 0 && node.assignedTaskIds.length === 0
    )).toBe(true);
    expect(stopped.messages.every((message) => message.status === "FAILED")).toBe(true);
  });
});