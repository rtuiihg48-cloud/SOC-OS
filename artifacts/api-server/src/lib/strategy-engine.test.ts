import { describe, expect, it } from "vitest";
import { chooseStrategy, strategyCost, strategyDeadlineMs } from "./strategy-engine";

describe("strategy engine", () => {
  it("starts with a balanced baseline when there is no history", () => {
    const decision = chooseStrategy({
      totalSamples: 0,
      lowestDefenseSuccessRate: 0,
      highestResidualRisk: 0,
      markovConfidence: 0,
    });
    expect(decision.mode).toBe("balanced");
    expect(decision.computeBudget).toBe(45);
    expect(decision.maxDurationMs).toBe(800);
  });

  it("selects deep analysis for weak defense history", () => {
    const decision = chooseStrategy({
      totalSamples: 4,
      lowestDefenseSuccessRate: 0.4,
      highestResidualRisk: 9,
      markovConfidence: 0.8,
    });
    expect(decision.mode).toBe("deep");
    expect(decision.computeBudget).toBe(70);
    expect(decision.confidence).toBeGreaterThan(0.8);
  });

  it("selects fast analysis only for stable verified history", () => {
    const decision = chooseStrategy({
      totalSamples: 12,
      lowestDefenseSuccessRate: 0.82,
      highestResidualRisk: 2,
      markovConfidence: 0.5,
    });
    expect(decision.mode).toBe("fast");
    expect(strategyCost(decision.mode)).toBe(8);
    expect(strategyDeadlineMs(decision.mode)).toBe(400);
  });
});