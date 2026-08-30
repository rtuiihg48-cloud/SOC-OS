export type AttackLinkType =
  | "sequence"
  | "same_pattern"
  | "same_technique"
  | "shared_vulnerability";

export interface AttackGraphPrediction {
  family: string;
  tactic: string | null;
  techniqueId: string | null;
  predictedVulnerability: string | null;
}

export interface PriorAttackPrediction extends AttackGraphPrediction {
  id: number;
  createdAtMs: number;
}

export interface AttackLinkCandidate {
  fromPredictionId: number;
  linkType: AttackLinkType;
  confidence: number;
  evidence: Record<string, number | string | boolean | null>;
  explanation: string;
}

const ATTACK_CHAIN_ORDER: Record<string, number> = {
  discovery: 1,
  initial_access: 2,
  credential_access: 3,
  privilege_escalation: 4,
  lateral_movement: 5,
  command_and_control: 6,
  exfiltration: 7,
  impact: 8,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function buildAttackLinkCandidates(
  predictionId: number,
  current: AttackGraphPrediction,
  previous: PriorAttackPrediction[],
  nowMs: number,
): AttackLinkCandidate[] {
  const candidates: AttackLinkCandidate[] = [];
  const currentOrder = ATTACK_CHAIN_ORDER[current.family] ?? 0;

  for (const prior of previous) {
    const hoursApart = Math.max(0, (nowMs - prior.createdAtMs) / (60 * 60 * 1000));
    const evidence = {
      previousFamily: prior.family,
      currentFamily: current.family,
      previousTactic: prior.tactic,
      currentTactic: current.tactic,
      previousTechniqueId: prior.techniqueId,
      currentTechniqueId: current.techniqueId,
      hoursApart: Number(hoursApart.toFixed(3)),
    };

    if (prior.techniqueId && current.techniqueId && prior.techniqueId === current.techniqueId) {
      candidates.push({
        fromPredictionId: prior.id,
        linkType: "same_technique",
        confidence: 0.9,
        evidence: { ...evidence, sameTechnique: true },
        explanation: `Both predictions map to MITRE technique ${prior.techniqueId}.`,
      });
    }

    if (prior.family === current.family) {
      candidates.push({
        fromPredictionId: prior.id,
        linkType: "same_pattern",
        confidence: 0.72,
        evidence: { ...evidence, sameAttackFamily: true },
        explanation: `Both predictions belong to the ${current.family} attack family.`,
      });
    }

    if (
      prior.predictedVulnerability &&
      current.predictedVulnerability &&
      prior.predictedVulnerability.split(":")[0] === current.predictedVulnerability.split(":")[0]
    ) {
      candidates.push({
        fromPredictionId: prior.id,
        linkType: "shared_vulnerability",
        confidence: 0.84,
        evidence: { ...evidence, sharedVulnerabilityFamily: true },
        explanation: `Both predictions identify a residual ${current.family} exposure pattern.`,
      });
    }

    const priorOrder = ATTACK_CHAIN_ORDER[prior.family] ?? 0;
    if (priorOrder > 0 && currentOrder > priorOrder && hoursApart <= 24) {
      const chainConfidence = clamp(0.68 + Math.min(0.18, ((24 - hoursApart) / 24) * 0.18), 0, 0.95);
      candidates.push({
        fromPredictionId: prior.id,
        linkType: "sequence",
        confidence: chainConfidence,
        evidence: { ...evidence, priorChainPosition: priorOrder, currentChainPosition: currentOrder },
        explanation: `${prior.family} precedes ${current.family} in the simulated attack-chain model.`,
      });
    }
  }

  const uniqueCandidates = new Map<string, AttackLinkCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.fromPredictionId}:${candidate.linkType}`;
    const existing = uniqueCandidates.get(key);
    if (!existing || existing.confidence < candidate.confidence) {
      uniqueCandidates.set(key, candidate);
    }
  }

  return [...uniqueCandidates.values()]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 8);
}