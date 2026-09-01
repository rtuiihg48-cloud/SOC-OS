import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  CYBER_RANGE_SCENARIOS,
  type CyberRangeScenario,
} from "./cyber-range";

export const NODE_CLUSTER_SIZE = 10;
export const NODE_CLUSTER_MAX_ACTIVE_TASKS = 4;

export const NODE_CAPABILITIES = [
  "CPU",
  "MEMORY",
  "NUMA",
  "CACHE",
  "TELEMETRY",
] as const;

export type NodeCapability = (typeof NODE_CAPABILITIES)[number];
export type NodeRuntime = "PROCESS" | "CONTAINER" | "VM";
export type NodeStatus =
  | "ONLINE"
  | "BUSY"
  | "DEGRADED"
  | "OFFLINE"
  | "QUARANTINED"
  | "DRAINING";
export type NodeTaskKind = "SIMULATION" | "OBSERVATION";
export type NodeTaskPriority = "LOW" | "NORMAL" | "HIGH";
export type NodeRelayStatus =
  | "CREATED"
  | "QUEUED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "EXECUTED"
  | "FAILED";

export type NodeRecord = {
  nodeId: string;
  displayName: string;
  runtime: NodeRuntime;
  status: NodeStatus;
  capabilities: NodeCapability[];
  capacity: number;
  activeTasks: number;
  healthScore: number;
  lastHeartbeat: string;
  boundary: "TRUSTED_FIXED_CODE_PROCESS";
  assignedTaskIds: string[];
};

export type NodeTaskTransition = {
  status: NodeRelayStatus;
  at: string;
  reason: string | null;
};

export type NodeRelayMessage = {
  messageId: string;
  taskId: string;
  correlationId: string;
  source: "AI_CORE";
  destinationNodeId: string | null;
  kind: NodeTaskKind;
  scenario: CyberRangeScenario | null;
  requiredCapabilities: NodeCapability[];
  priority: NodeTaskPriority;
  status: NodeRelayStatus;
  transitions: NodeTaskTransition[];
  submittedAt: string;
  updatedAt: string;
  expiresAt: string;
  executionMode: "FIXED_CODE_ONLY";
  payloadPolicy: "ALLOWLISTED_METADATA_ONLY";
  relayAuthentication: "ED25519_TASK_SIGNATURE";
  taskSignatureVerified: boolean;
  resultObservation: string | null;
};

export type NodeTaskInput =
  | {
      kind: "SIMULATION";
      scenario: CyberRangeScenario;
      requiredCapabilities: NodeCapability[];
      priority?: NodeTaskPriority;
    }
  | {
      kind: "OBSERVATION";
      scenario: null;
      requiredCapabilities: NodeCapability[];
      priority?: NodeTaskPriority;
    };

type TenantCluster = {
  nodes: NodeRecord[];
  messages: NodeRelayMessage[];
};

type PendingTask = {
  tenantId: number;
  messageId: string;
};

type ActiveExecution = {
  child: ChildProcess;
  cluster: TenantCluster;
  node: NodeRecord;
  message: NodeRelayMessage;
  timeout: NodeJS.Timeout | null;
};

type WorkerResult = {
  taskId: string;
  signatureVerified: true;
  observation: string;
};

export class NodeClusterError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(code);
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function capabilitiesForNode(index: number): NodeCapability[] {
  const capabilities: NodeCapability[] = ["CPU", "TELEMETRY"];
  if (index % 2 === 0) capabilities.push("MEMORY", "CACHE");
  if (index % 3 !== 1) capabilities.push("NUMA");
  return capabilities;
}

function createNodes(): NodeRecord[] {
  const createdAt = timestamp();
  return Array.from({ length: NODE_CLUSTER_SIZE }, (_, index) => ({
    nodeId: `NODE-${String(index + 1).padStart(2, "0")}`,
    displayName: `AI WORKER ${String(index + 1).padStart(2, "0")}`,
    runtime: "PROCESS" as const,
    status: "ONLINE" as const,
    capabilities: capabilitiesForNode(index),
    capacity: index < 4 ? 2 : 1,
    activeTasks: 0,
    healthScore: 96 - (index % 5),
    lastHeartbeat: createdAt,
    boundary: "TRUSTED_FIXED_CODE_PROCESS" as const,
    assignedTaskIds: [],
  }));
}

const nodeWorkerSource = `
const { createPublicKey, verify } = require("node:crypto");
const payloadBuffer = Buffer.from(process.argv[1] || "", "base64");
const signature = Buffer.from(process.argv[2] || "", "base64");
const publicKeyPem = Buffer.from(process.argv[3] || "", "base64").toString("utf8");
let task;
try {
  const publicKey = createPublicKey(publicKeyPem);
  if (!verify(null, payloadBuffer, publicKey, signature)) process.exit(42);
  task = JSON.parse(payloadBuffer.toString("utf8"));
} catch {
  process.exit(43);
}
const kinds = ["SIMULATION", "OBSERVATION"];
const scenarios = ["MESI_COHERENCE", "NUMA_LATENCY", "PIPELINE_STALL", "SCHEDULER_PRESSURE", "QUARANTINE_PROPAGATION"];
const capabilities = ["CPU", "MEMORY", "NUMA", "CACHE", "TELEMETRY"];
if (
  !kinds.includes(task.kind) ||
  !Array.isArray(task.requiredCapabilities) ||
  task.requiredCapabilities.some((value) => !capabilities.includes(value)) ||
  (task.kind === "SIMULATION" && !scenarios.includes(task.scenario)) ||
  (task.kind === "OBSERVATION" && task.scenario !== null)
) process.exit(44);
const nodeNumber = Number(String(task.destinationNodeId).slice(-2)) || 1;
const durationMs = 180 + (nodeNumber % 5) * 45;
setTimeout(() => {
  const observation = task.kind === "SIMULATION"
    ? String(task.scenario).toLowerCase().replaceAll("_", "-") + "-completed"
    : "node-health-observation-completed";
  process.stdout.write(JSON.stringify({
    taskId: task.taskId,
    signatureVerified: true,
    observation
  }));
}, durationMs);
`;

function priorityWeight(priority: NodeTaskPriority): number {
  if (priority === "HIGH") return 0;
  if (priority === "NORMAL") return 1;
  return 2;
}

function cloneMessage(message: NodeRelayMessage): NodeRelayMessage {
  return {
    ...message,
    requiredCapabilities: [...message.requiredCapabilities],
    transitions: message.transitions.map((transition) => ({ ...transition })),
  };
}

export class NodeClusterManager {
  private readonly clusters = new Map<number, TenantCluster>();
  private readonly pendingTasks: PendingTask[] = [];
  private readonly activeExecutions = new Set<ActiveExecution>();
  private readonly relayPrivateKey;
  private readonly relayPublicKeyPem;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    this.relayPrivateKey = privateKey;
    this.relayPublicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  }

  snapshot(tenantId: number) {
    const cluster = this.getOrCreate(tenantId);
    const messages = [...cluster.messages]
      .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
      .slice(0, 50)
      .map(cloneMessage);
    return {
      coordination: "INSTANCE_LOCAL_VOLATILE" as const,
      transportBoundary: "SIGNED_LOCAL_IPC_RELAY" as const,
      relayAuthentication: "ED25519_TASK_SIGNATURE" as const,
      payloadPolicy: "ALLOWLISTED_METADATA_ONLY" as const,
      maxNodes: NODE_CLUSTER_SIZE,
      nodes: cluster.nodes.map((node) => ({
        ...node,
        capabilities: [...node.capabilities],
        assignedTaskIds: [...node.assignedTaskIds],
      })),
      messages,
      queueDepth: this.pendingTasks.filter((task) => task.tenantId === tenantId).length,
      activeTasks: cluster.nodes.reduce((sum, node) => sum + node.activeTasks, 0),
      completedTasks: cluster.messages.filter((message) => message.status === "EXECUTED").length,
      rejectedTasks: cluster.messages.filter((message) =>
        message.status === "REJECTED" || message.status === "EXPIRED" || message.status === "FAILED"
      ).length,
    };
  }

  listMessages(tenantId: number): NodeRelayMessage[] {
    return this.snapshot(tenantId).messages;
  }

  dispatch(
    tenantId: number,
    correlationId: string,
    input: NodeTaskInput,
  ): NodeRelayMessage {
    this.assertInput(input);
    const cluster = this.getOrCreate(tenantId);
    const now = timestamp();
    const message: NodeRelayMessage = {
      messageId: `msg_${randomUUID()}`,
      taskId: `task_${randomUUID()}`,
      correlationId,
      source: "AI_CORE",
      destinationNodeId: null,
      kind: input.kind,
      scenario: input.scenario ?? null,
      requiredCapabilities: [...new Set(input.requiredCapabilities)],
      priority: input.priority ?? "NORMAL",
      status: "CREATED",
      transitions: [{ status: "CREATED", at: now, reason: null }],
      submittedAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      executionMode: "FIXED_CODE_ONLY",
      payloadPolicy: "ALLOWLISTED_METADATA_ONLY",
      relayAuthentication: "ED25519_TASK_SIGNATURE",
      taskSignatureVerified: false,
      resultObservation: null,
    };
    this.transition(message, "QUEUED");
    cluster.messages.push(message);
    this.pendingTasks.push({ tenantId, messageId: message.messageId });
    this.sortPendingTasks();
    this.trimHistory(cluster);
    this.schedule();
    return cloneMessage(message);
  }

  stopAll(): void {
    this.pendingTasks.splice(0);
    for (const execution of [...this.activeExecutions]) {
      if (!this.activeExecutions.delete(execution)) continue;
      if (execution.timeout) clearTimeout(execution.timeout);
      execution.child.kill("SIGKILL");
      if (execution.message.status === "ACCEPTED") {
        this.transition(execution.message, "FAILED", "CONTROL_PLANE_STOPPED");
      }
      this.releaseNode(execution.node, execution.message.taskId);
    }
    for (const cluster of this.clusters.values()) {
      const stoppedAt = timestamp();
      for (const message of cluster.messages) {
        if (message.status === "QUEUED") {
          message.status = "FAILED";
          message.updatedAt = stoppedAt;
          message.transitions.push({
            status: "FAILED",
            at: stoppedAt,
            reason: "CONTROL_PLANE_STOPPED",
          });
        }
      }
      for (const node of cluster.nodes) {
        node.activeTasks = 0;
        node.assignedTaskIds = [];
        node.status = "ONLINE";
      }
    }
  }

  private getOrCreate(tenantId: number): TenantCluster {
    const existing = this.clusters.get(tenantId);
    if (existing) return existing;
    const cluster: TenantCluster = {
      nodes: createNodes(),
      messages: [],
    };
    this.clusters.set(tenantId, cluster);
    return cluster;
  }

  private assertInput(input: NodeTaskInput): void {
    if (input.requiredCapabilities.length === 0 || input.requiredCapabilities.length > NODE_CAPABILITIES.length) {
      throw new NodeClusterError("INVALID_REQUIRED_CAPABILITIES", 400);
    }
    if (input.requiredCapabilities.some((capability) => !NODE_CAPABILITIES.includes(capability))) {
      throw new NodeClusterError("UNSUPPORTED_NODE_CAPABILITY", 400);
    }
    if (new Set(input.requiredCapabilities).size !== input.requiredCapabilities.length) {
      throw new NodeClusterError("DUPLICATE_REQUIRED_CAPABILITY", 400);
    }
    if (input.kind === "SIMULATION" && !CYBER_RANGE_SCENARIOS.includes(input.scenario)) {
      throw new NodeClusterError("SIMULATION_SCENARIO_REQUIRED", 400);
    }
    if (input.kind === "OBSERVATION" && input.scenario !== null) {
      throw new NodeClusterError("OBSERVATION_SCENARIO_NOT_ALLOWED", 400);
    }
  }

  private schedule(): void {
    while (this.activeExecutions.size < NODE_CLUSTER_MAX_ACTIVE_TASKS) {
      const next = this.takeNextEligibleTask();
      if (!next) return;
      this.execute(next.cluster, next.node, next.message);
    }
  }

  private sortPendingTasks(): void {
    this.pendingTasks.sort((leftTask, rightTask) => {
      const leftCluster = this.clusters.get(leftTask.tenantId);
      const rightCluster = this.clusters.get(rightTask.tenantId);
      const left = leftCluster?.messages.find((message) => message.messageId === leftTask.messageId);
      const right = rightCluster?.messages.find((message) => message.messageId === rightTask.messageId);
      if (!left || !right) return left ? -1 : right ? 1 : 0;
      const priorityDifference = priorityWeight(left.priority) - priorityWeight(right.priority);
      return priorityDifference || Date.parse(left.submittedAt) - Date.parse(right.submittedAt);
    });
  }

  private takeNextEligibleTask(): {
    cluster: TenantCluster;
    node: NodeRecord;
    message: NodeRelayMessage;
  } | null {
    for (let index = 0; index < this.pendingTasks.length; index += 1) {
      const pending = this.pendingTasks[index]!;
      const cluster = this.clusters.get(pending.tenantId);
      const message = cluster?.messages.find((candidate) => candidate.messageId === pending.messageId);
      if (!cluster || !message || message.status !== "QUEUED") {
        this.pendingTasks.splice(index, 1);
        index -= 1;
        continue;
      }
      if (Date.parse(message.expiresAt) <= Date.now()) {
        this.pendingTasks.splice(index, 1);
        this.transition(message, "EXPIRED", "TASK_TTL_EXCEEDED");
        index -= 1;
        continue;
      }
      const node = this.selectNode(cluster.nodes, message.requiredCapabilities);
      if (!node) continue;
      this.pendingTasks.splice(index, 1);
      return { cluster, node, message };
    }
    return null;
  }

  private selectNode(nodes: NodeRecord[], requiredCapabilities: NodeCapability[]): NodeRecord | undefined {
    return nodes
      .filter((node) =>
        (node.status === "ONLINE" || node.status === "BUSY") &&
        node.activeTasks < node.capacity &&
        requiredCapabilities.every((capability) => node.capabilities.includes(capability))
      )
      .sort((left, right) => {
        const leftLoad = left.activeTasks / left.capacity;
        const rightLoad = right.activeTasks / right.capacity;
        return leftLoad - rightLoad || right.healthScore - left.healthScore || left.nodeId.localeCompare(right.nodeId);
      })[0];
  }

  private execute(cluster: TenantCluster, node: NodeRecord, message: NodeRelayMessage): void {
    node.activeTasks += 1;
    node.assignedTaskIds.push(message.taskId);
    node.status = "BUSY";
    node.lastHeartbeat = timestamp();
    message.destinationNodeId = node.nodeId;
    const signedTask = JSON.stringify({
      messageId: message.messageId,
      taskId: message.taskId,
      correlationId: message.correlationId,
      destinationNodeId: node.nodeId,
      kind: message.kind,
      scenario: message.scenario,
      requiredCapabilities: message.requiredCapabilities,
      priority: message.priority,
      executionMode: message.executionMode,
      payloadPolicy: message.payloadPolicy,
      expiresAt: message.expiresAt,
    });
    const payloadBuffer = Buffer.from(signedTask, "utf8");
    const signature = sign(null, payloadBuffer, this.relayPrivateKey);
    const child = spawn(process.execPath, [
      "-e",
      nodeWorkerSource,
      payloadBuffer.toString("base64"),
      signature.toString("base64"),
      Buffer.from(this.relayPublicKeyPem, "utf8").toString("base64"),
    ], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
    });
    const execution: ActiveExecution = {
      child,
      cluster,
      node,
      message,
      timeout: null,
    };
    this.activeExecutions.add(execution);
    this.transition(message, "ACCEPTED");

    let output = "";
    execution.timeout = setTimeout(() => {
      child.kill("SIGKILL");
      this.finishExecution(execution, null, "WORKER_TIMEOUT");
    }, 2_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 16_384) {
        child.kill("SIGKILL");
        this.finishExecution(execution, null, "WORKER_OUTPUT_LIMIT_EXCEEDED");
      }
    });
    child.once("error", () => this.finishExecution(execution, null, "WORKER_SPAWN_FAILED"));
    child.once("close", (code) => {
      if (code !== 0) {
        this.finishExecution(execution, null, `WORKER_EXIT_${code ?? "UNKNOWN"}`);
        return;
      }
      try {
        const result = JSON.parse(output) as WorkerResult;
        if (
          result.taskId !== message.taskId ||
          result.signatureVerified !== true ||
          typeof result.observation !== "string"
        ) {
          this.finishExecution(execution, null, "INVALID_WORKER_RECEIPT");
          return;
        }
        this.finishExecution(execution, result, null);
      } catch {
        this.finishExecution(execution, null, "INVALID_WORKER_RECEIPT");
      }
    });
  }

  private finishExecution(
    execution: ActiveExecution,
    result: WorkerResult | null,
    error: string | null,
  ): void {
    if (!this.activeExecutions.delete(execution)) return;
    if (execution.timeout) clearTimeout(execution.timeout);
    if (result) {
      execution.message.taskSignatureVerified = result.signatureVerified;
      execution.message.resultObservation = result.observation;
      this.transition(execution.message, "EXECUTED");
    } else {
      this.transition(execution.message, "FAILED", error ?? "WORKER_FAILED");
    }
    this.releaseNode(execution.node, execution.message.taskId);
    this.schedule();
  }

  private releaseNode(node: NodeRecord, taskId: string): void {
    node.activeTasks = Math.max(0, node.activeTasks - 1);
    node.assignedTaskIds = node.assignedTaskIds.filter((assignedTaskId) => assignedTaskId !== taskId);
    node.status = node.activeTasks > 0 ? "BUSY" : "ONLINE";
    node.lastHeartbeat = timestamp();
  }

  private transition(message: NodeRelayMessage, status: NodeRelayStatus, reason: string | null = null): void {
    const at = timestamp();
    message.status = status;
    message.updatedAt = at;
    message.transitions.push({ status, at, reason });
  }

  private trimHistory(cluster: TenantCluster): void {
    if (cluster.messages.length <= 100) return;
    const active = cluster.messages.filter((message) => message.status === "QUEUED" || message.status === "ACCEPTED");
    const terminal = cluster.messages.filter((message) => message.status !== "QUEUED" && message.status !== "ACCEPTED");
    cluster.messages = [...terminal.slice(-(100 - active.length)), ...active];
  }
}

export const nodeClusterManager = new NodeClusterManager();