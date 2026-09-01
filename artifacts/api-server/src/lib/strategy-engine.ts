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
  allocationNode: "N7";
  computeNode: "N2";
  learningNode: "N3";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
    allocationNode: "N7",
    computeNode: "N2",
    learningNode: "N3",
  };
}

export function strategyCost(mode: StrategyMode): number {
  return mode === "fast" ? 8 : mode === "deep" ? 26 : 16;
}