export interface MarkovAnalysis {
  layer: "markov";
  modelVersion: "markov-v1";
  sequenceLength: number;
  previousFamily: string | null;
  currentFamily: string;
  transitionCount: number;
  transitionTotal: number;
  transitionProbability: number;
  predictedNextFamily: string | null;
  predictedNextProbability: number;
  confidence: number;
  transitionMatrix: Record<string, Record<string, number>>;
}

const MODEL_VERSION = "markov-v1" as const;
const SMOOTHING_ALPHA = 1;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableFamilyList(sequence: string[], candidateFamilies: string[]): string[] {
  return [...new Set([...sequence, ...candidateFamilies].filter(Boolean))].sort();
}

function buildTransitionCounts(sequence: string[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (let index = 1; index < sequence.length; index += 1) {
    const from = sequence[index - 1]!;
    const to = sequence[index]!;
    const row = counts.get(from) ?? new Map<string, number>();
    row.set(to, (row.get(to) ?? 0) + 1);
    counts.set(from, row);
  }
  return counts;
}

function probabilitiesForState(
  from: string | null,
  families: string[],
  counts: Map<string, Map<string, number>>,
): Record<string, number> {
  if (!from || families.length === 0) return {};
  const row = counts.get(from) ?? new Map<string, number>();
  const denominator = families.reduce((sum, family) => sum + (row.get(family) ?? 0) + SMOOTHING_ALPHA, 0);
  return Object.fromEntries(
    families.map((family) => [
      family,
      Number((((row.get(family) ?? 0) + SMOOTHING_ALPHA) / denominator).toFixed(6)),
    ]),
  );
}

export function analyzeMarkovLayer(
  sequence: string[],
  currentFamily: string,
  candidateFamilies: string[],
): MarkovAnalysis {
  const normalizedSequence = sequence.filter(Boolean);
  const families = stableFamilyList(normalizedSequence, candidateFamilies);
  const counts = buildTransitionCounts(normalizedSequence);
  const previousFamily = normalizedSequence.at(-1) ?? null;
  const incomingRow = previousFamily ? counts.get(previousFamily) ?? new Map<string, number>() : new Map();
  const transitionCount = incomingRow.get(currentFamily) ?? 0;
  const transitionTotal = [...incomingRow.values()].reduce((sum, value) => sum + value, 0);
  const currentProbabilityRow = probabilitiesForState(previousFamily, families, counts);
  const transitionProbability = currentProbabilityRow[currentFamily] ?? (1 / Math.max(families.length, 1));

  const nextState = currentFamily || previousFamily;
  const nextProbabilities = probabilitiesForState(nextState, families, counts);
  const predictedNextFamily = Object.entries(nextProbabilities)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
  const predictedNextProbability = predictedNextFamily ? nextProbabilities[predictedNextFamily]! : 0;
  const evidenceStrength = clamp(transitionTotal / 5, 0, 1);
  const confidence = Number(
    clamp(
      0.25 + evidenceStrength * 0.45 + (transitionCount > 0 ? 0.2 : 0) + predictedNextProbability * 0.1,
      0.25,
      0.95,
    ).toFixed(6),
  );

  const transitionMatrix: Record<string, Record<string, number>> = {};
  for (const family of families) {
    transitionMatrix[family] = probabilitiesForState(family, families, counts);
  }

  return {
    layer: "markov",
    modelVersion: MODEL_VERSION,
    sequenceLength: normalizedSequence.length,
    previousFamily,
    currentFamily,
    transitionCount,
    transitionTotal,
    transitionProbability,
    predictedNextFamily,
    predictedNextProbability,
    confidence,
    transitionMatrix,
  };
}