export type StrategyMode = "fast" | "balanced" | "deep";

export interface StrategyInput {
  totalSamples: number;
  lowestDefenseSuccessRate: number;
  highestResidualRisk: number;
  markovConfidence: number;
}

export interface StrategyDecision {
  mode: StrategyMode;
  reason: string;
  confidence: number;
  computeBudget: number;
  maxDurationMs: number;
  allocationNode: "N7";
  computeNode: "N2";
  learningNode: "N3";
}

export type ScenarioPhase = "stability" | "growth" | "collapse" | "mutation";
export type ScenarioObjective = "detect" | "explain" | "contain" | "recover";

export interface ScenarioContext {
  phase: ScenarioPhase;
  objective: ScenarioObjective;
  evidenceWindowHours: number;
  evidenceFreshness: "fresh" | "aging" | "insufficient";
  triggerSignals: string[];
  operatorReviewRequired: boolean;
}

export interface ScenarioContextInput {
  riskScore: number;
  residualRisk: number;
  confidence: number;
  sampleCount: number;
  defenseSuccessRate: number;
}

export interface StrategySandboxCandidate {
  mode: StrategyMode;
  computeBudget: number;
  expectedQuality: number;
  expectedCost: number;
  selected: boolean;
}

export interface StrategySandboxExecution {
  scenariosEvaluated: number;
  depthUsed: number;
  runtimeMs: number;
  deadlineEnforced: true;
}

export const SANDBOX_LIMITS = {
  maxDepth: 2,
  maxScenarios: 3,
  maxRuntimeMs: 1500,
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function deriveScenarioContext(input: ScenarioContextInput): ScenarioContext {
  const triggerSignals: string[] = [];
  if (input.riskScore >= 60) triggerSignals.push("elevated risk score");
  if (input.residualRisk >= 8) triggerSignals.push("high residual risk");
  if (input.confidence < 0.6) triggerSignals.push("low decision confidence");
  if (input.defenseSuccessRate < 0.65) triggerSignals.push("weak defense coverage");
  if (input.sampleCount < 3) triggerSignals.push("limited verified evidence");

  const evidenceFreshness = input.sampleCount === 0
    ? "insufficient"
    : input.sampleCount < 3
      ? "aging"
      : "fresh";
  const phase: ScenarioPhase = input.residualRisk >= 8 || input.riskScore >= 75
    ? "collapse"
    : input.confidence < 0.6 || input.defenseSuccessRate < 0.65
      ? "mutation"
      : input.sampleCount === 0
        ? "growth"
        : "stability";
  const objective: ScenarioObjective = phase === "collapse"
    ? "contain"
    : phase === "mutation"
      ? "recover"
      : phase === "growth"
        ? "detect"
        : "explain";

  return {
    phase,
    objective,
    evidenceWindowHours: 24,
    evidenceFreshness,
    triggerSignals: triggerSignals.length > 0 ? triggerSignals : ["verified signals within expected range"],
    operatorReviewRequired: phase === "collapse" || evidenceFreshness !== "fresh",
  };
}

export function chooseStrategy(input: StrategyInput): StrategyDecision {
  const hasHistory = input.totalSamples > 0;
  const unstableHistory = hasHistory && (
    input.lowestDefenseSuccessRate < 0.55 ||
    input.highestResidualRisk >= 8
  );
  const stableHistory = hasHistory &&
    input.totalSamples >= 8 &&
    input.lowestDefenseSuccessRate >= 0.75 &&
    input.highestResidualRisk < 4;

  if (unstableHistory) {
    return {
      mode: "deep",
      reason: "High residual risk or weak historical defense coverage requires deeper analysis.",
      confidence: clamp(0.72 + input.markovConfidence * 0.18, 0.72, 0.94),
      computeBudget: 70,
      maxDurationMs: 1200,
      allocationNode: "N7",
      computeNode: "N2",
      learningNode: "N3",
    };
  }

  if (stableHistory) {
    return {
      mode: "fast",
      reason: "Recent verified outcomes are stable; prioritize fast coverage and lower compute cost.",
      confidence: clamp(0.68 + input.markovConfidence * 0.2, 0.68, 0.9),
      computeBudget: 25,
      maxDurationMs: 400,
      allocationNode: "N7",
      computeNode: "N2",
      learningNode: "N3",
    };
  }

  return {
    mode: "balanced",
    reason: hasHistory
      ? "Evidence is mixed; balance exploration with measured compute cost."
      : "No verified history is available; establish a balanced baseline.",
    confidence: clamp(0.58 + input.markovConfidence * 0.22, 0.58, 0.84),
    computeBudget: 45,
    maxDurationMs: 800,
    allocationNode: "N7",
    computeNode: "N2",
    learningNode: "N3",
  };
}

export function strategyDeadlineMs(mode: StrategyMode): number {
  return mode === "fast" ? 400 : mode === "deep" ? 1200 : 800;
}

export function strategyCost(mode: StrategyMode): number {
  return mode === "fast" ? 8 : mode === "deep" ? 26 : 16;
}

export function compareStrategies(
  input: StrategyInput & ScenarioContextInput,
): {
  selected: StrategyDecision;
  candidates: StrategySandboxCandidate[];
  execution: StrategySandboxExecution;
} {
  const startedAt = performance.now();
  const deadline = startedAt + SANDBOX_LIMITS.maxRuntimeMs;
  const selected = chooseStrategy(input);
  const context = deriveScenarioContext(input);
  const qualityByMode: Record<StrategyMode, number> = {
    fast: 0.58 + input.confidence * 0.24 - context.triggerSignals.length * 0.015,
    balanced: 0.64 + input.confidence * 0.28 - context.triggerSignals.length * 0.008,
    deep: 0.7 + input.confidence * 0.3 - context.triggerSignals.length * 0.004,
  };
  const candidates: StrategySandboxCandidate[] = [];
  for (const mode of (["fast", "balanced", "deep"] as const).slice(0, SANDBOX_LIMITS.maxScenarios)) {
    if (performance.now() > deadline) throw new Error("STRATEGY_SANDBOX_DEADLINE_EXCEEDED");
    candidates.push({
      mode,
      computeBudget: mode === "fast" ? 25 : mode === "deep" ? 70 : 45,
      expectedQuality: clamp(qualityByMode[mode], 0, 1),
      expectedCost: strategyCost(mode),
      selected: mode === selected.mode,
    });
  }
  const runtimeMs = Math.max(0, performance.now() - startedAt);
  if (runtimeMs > SANDBOX_LIMITS.maxRuntimeMs) {
    throw new Error("STRATEGY_SANDBOX_DEADLINE_EXCEEDED");
  }
  return {
    selected,
    candidates,
    execution: {
      scenariosEvaluated: candidates.length,
      depthUsed: 0,
      runtimeMs,
      deadlineEnforced: true,
    },
  };
}