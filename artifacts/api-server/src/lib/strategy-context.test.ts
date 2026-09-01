import { describe, expect, it } from "vitest";
import { compareStrategies, deriveScenarioContext, SANDBOX_LIMITS } from "./strategy-engine";

describe("scenario context and bounded strategy comparison", () => {
  it("marks high residual risk for containment and operator review", () => {
    const context = deriveScenarioContext({
      riskScore: 52,
      residualRisk: 9,
      confidence: 0.82,
      sampleCount: 12,
      defenseSuccessRate: 0.8,
    });
    expect(context.phase).toBe("collapse");
    expect(context.objective).toBe("contain");
    expect(context.operatorReviewRequired).toBe(true);
  });

  it("compares all modes deterministically within sandbox limits", () => {
    const comparison = compareStrategies({
      totalSamples: 5,
      lowestDefenseSuccessRate: 0.7,
      highestResidualRisk: 3,
      markovConfidence: 0.4,
      riskScore: 28,
      residualRisk: 3,
      confidence: 0.76,
      sampleCount: 5,
      defenseSuccessRate: 0.7,
    });
    expect(comparison.candidates).toHaveLength(3);
    expect(comparison.candidates.filter((candidate) => candidate.selected)).toHaveLength(1);
    expect(SANDBOX_LIMITS.maxDepth).toBe(2);
  });
});