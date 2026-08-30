import crypto from "node:crypto";

export type ObserverTaskType = "analyze_event" | "analyze_system" | "inspect_memory";
export type ObserverToolName = "analyze_event" | "read_system_metrics" | "inspect_memory";

export interface ObserverInput {
  taskType: ObserverTaskType;
  instruction: string;
  event?: string;
  tenantId?: number;
}

export interface ObserverPolicyDecision {
  allowed: boolean;
  riskScore: number;
  capabilities: ObserverToolName[];
  reasons: string[];
}

export interface ObserverPlanStep {
  id: string;
  tool: ObserverToolName;
  dependsOn: string[];
}

export interface ObserverStepResult {
  stepId: string;
  tool: ObserverToolName;
  status: "completed" | "failed";
  output?: unknown;
  error?: string;
}

export interface ObserverReflection {
  approved: boolean;
  score: number;
  evidenceComplete: boolean;
  issues: string[];
  suggestion: "retain" | "review";
}

export interface ObserverRun {
  runId: string;
  status: "blocked" | "completed" | "failed";
  input: ObserverInput;
  policy: ObserverPolicyDecision;
  plan: ObserverPlanStep[];
  results: ObserverStepResult[];
  reflection: ObserverReflection;
  productionChanged: false;
}

export interface ObserverToolAdapters {
  analyzeEvent(event: string): Promise<unknown>;
  readSystemMetrics(): Promise<unknown>;
  inspectMemory(tenantId?: number): Promise<unknown>;
}

const TASK_CAPABILITIES: Record<ObserverTaskType, ObserverToolName[]> = {
  analyze_event: ["analyze_event", "inspect_memory"],
  analyze_system: ["read_system_metrics", "inspect_memory"],
  inspect_memory: ["inspect_memory"],
};

const FORBIDDEN_INTENT_PATTERNS: Array<{ pattern: RegExp; reason: string; weight: number }> = [
  { pattern: /\b(shell|terminal|command prompt)\b/i, reason: "Shell execution is outside observer-only scope.", weight: 3 },
  { pattern: /\b(run|execute|launch)\s+(a\s+)?(command|script|binary|payload|exploit)\b/i, reason: "Executable actions are prohibited.", weight: 4 },
  { pattern: /\b(rm\s+-rf|drop\s+table|truncate\s+table|delete\s+from)\b/i, reason: "Destructive operations are prohibited.", weight: 5 },
  { pattern: /\b(apply|install|deploy|restart|shutdown|kill)\b/i, reason: "Production or environment mutations require a separate authorized plane.", weight: 3 },
  { pattern: /\b(nmap|port\s*scan|scan\s+(the\s+)?network|exploit\s+(the\s+)?target)\b/i, reason: "Active scanning or exploitation is prohibited.", weight: 5 },
];

export function evaluateObserverPolicy(input: ObserverInput): ObserverPolicyDecision {
  const reasons: string[] = [];
  let riskScore = 0;

  for (const rule of FORBIDDEN_INTENT_PATTERNS) {
    if (!rule.pattern.test(input.instruction)) continue;
    reasons.push(rule.reason);
    riskScore += rule.weight;
  }

  if (input.taskType === "analyze_event" && !input.event?.trim()) {
    reasons.push("Event text is required for analyze_event.");
    riskScore += 3;
  }

  return {
    allowed: riskScore === 0,
    riskScore,
    capabilities: riskScore === 0 ? TASK_CAPABILITIES[input.taskType] : [],
    reasons,
  };
}

export function planObserverRun(input: ObserverInput, policy: ObserverPolicyDecision): ObserverPlanStep[] {
  if (!policy.allowed) return [];
  if (input.taskType === "analyze_event") {
    return [
      { id: "analyze-event", tool: "analyze_event", dependsOn: [] },
      { id: "inspect-memory", tool: "inspect_memory", dependsOn: [] },
    ];
  }
  if (input.taskType === "analyze_system") {
    return [
      { id: "read-system-metrics", tool: "read_system_metrics", dependsOn: [] },
      { id: "inspect-memory", tool: "inspect_memory", dependsOn: [] },
    ];
  }
  return [{ id: "inspect-memory", tool: "inspect_memory", dependsOn: [] }];
}

function reflectOnRun(
  policy: ObserverPolicyDecision,
  plan: ObserverPlanStep[],
  results: ObserverStepResult[],
): ObserverReflection {
  const failed = results.filter((result) => result.status === "failed");
  const missing = plan.filter((step) => !results.some((result) => result.stepId === step.id));
  const issues = [
    ...policy.reasons,
    ...failed.map((result) => `${result.tool} failed: ${result.error ?? "unknown error"}`),
    ...missing.map((step) => `${step.tool} produced no result.`),
  ];
  const evidenceComplete = policy.allowed && plan.length > 0 && failed.length === 0 && missing.length === 0;
  const score = policy.allowed
    ? Math.max(0, Math.min(1, 1 - failed.length * 0.35 - missing.length * 0.25))
    : 0;

  return {
    approved: evidenceComplete,
    score: Number(score.toFixed(2)),
    evidenceComplete,
    issues,
    suggestion: evidenceComplete ? "retain" : "review",
  };
}

export async function runObserverAgent(
  input: ObserverInput,
  tools: ObserverToolAdapters,
): Promise<ObserverRun> {
  const policy = evaluateObserverPolicy(input);
  const plan = planObserverRun(input, policy);
  const results: ObserverStepResult[] = [];

  if (policy.allowed) {
    for (const step of plan) {
      try {
        let output: unknown;
        if (step.tool === "analyze_event") {
          output = await tools.analyzeEvent(input.event!);
        } else if (step.tool === "read_system_metrics") {
          output = await tools.readSystemMetrics();
        } else {
          output = await tools.inspectMemory(input.tenantId);
        }
        results.push({ stepId: step.id, tool: step.tool, status: "completed", output });
      } catch (error) {
        results.push({
          stepId: step.id,
          tool: step.tool,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown observer tool error",
        });
      }
    }
  }

  const reflection = reflectOnRun(policy, plan, results);
  return {
    runId: crypto.randomUUID(),
    status: !policy.allowed ? "blocked" : reflection.approved ? "completed" : "failed",
    input,
    policy,
    plan,
    results,
    reflection,
    productionChanged: false,
  };
}