export interface QuantumAttackInput {
  attackFamily: string;
  riskScore: number;
  confidence: number;
  defenseSucceeded: boolean;
  residualRisk: number;
}

export interface QuantumAnalysis {
  layer: "quantum";
  modelVersion: "quantum-cpu-v1";
  qubitCount: 3;
  measuredState: string;
  stateProbabilities: number[];
  riskAmplitude: number;
  entropy: number;
  coherence: number;
  confidence: number;
}

interface ComplexNumber {
  real: number;
  imaginary: number;
}

const MODEL_VERSION = "quantum-cpu-v1" as const;
const QUBIT_COUNT = 3;
const STATE_SIZE = 2 ** QUBIT_COUNT;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function multiplyComplex(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return {
    real: left.real * right.real - left.imaginary * right.imaginary,
    imaginary: left.real * right.imaginary + left.imaginary * right.real,
  };
}

function familyFingerprint(family: string): number {
  return [...family].reduce((hash, character) => ((hash * 31 + character.charCodeAt(0)) >>> 0), 7);
}

function applyHadamard(state: ComplexNumber[], qubit: number): void {
  const factor = 1 / Math.sqrt(2);
  const mask = 1 << qubit;
  for (let index = 0; index < state.length; index += 1) {
    if ((index & mask) !== 0) continue;
    const pairedIndex = index | mask;
    const zero = state[index]!;
    const one = state[pairedIndex]!;
    state[index] = { real: (zero.real + one.real) * factor, imaginary: (zero.imaginary + one.imaginary) * factor };
    state[pairedIndex] = { real: (zero.real - one.real) * factor, imaginary: (zero.imaginary - one.imaginary) * factor };
  }
}

function applyPauliX(state: ComplexNumber[], qubit: number): void {
  const mask = 1 << qubit;
  for (let index = 0; index < state.length; index += 1) {
    if ((index & mask) !== 0) continue;
    const pairedIndex = index | mask;
    const value = state[index]!;
    state[index] = state[pairedIndex]!;
    state[pairedIndex] = value;
  }
}

function applyPauliZ(state: ComplexNumber[], qubit: number): void {
  const mask = 1 << qubit;
  for (let index = 0; index < state.length; index += 1) {
    if ((index & mask) === 0) continue;
    state[index] = {
      real: -state[index]!.real,
      imaginary: -state[index]!.imaginary,
    };
  }
}

function applyRy(state: ComplexNumber[], qubit: number, angle: number): void {
  const cosine = Math.cos(angle / 2);
  const sine = Math.sin(angle / 2);
  const mask = 1 << qubit;
  for (let index = 0; index < state.length; index += 1) {
    if ((index & mask) !== 0) continue;
    const pairedIndex = index | mask;
    const zero = state[index]!;
    const one = state[pairedIndex]!;
    state[index] = {
      real: cosine * zero.real - sine * one.real,
      imaginary: cosine * zero.imaginary - sine * one.imaginary,
    };
    state[pairedIndex] = {
      real: sine * zero.real + cosine * one.real,
      imaginary: sine * zero.imaginary + cosine * one.imaginary,
    };
  }
}

function applyCnot(state: ComplexNumber[], control: number, target: number): void {
  const controlMask = 1 << control;
  const targetMask = 1 << target;
  for (let index = 0; index < state.length; index += 1) {
    if ((index & controlMask) === 0 || (index & targetMask) !== 0) continue;
    const pairedIndex = index ^ targetMask;
    const value = state[index]!;
    state[index] = state[pairedIndex]!;
    state[pairedIndex] = value;
  }
}

export function analyzeQuantumLayer(input: QuantumAttackInput): QuantumAnalysis {
  const state: ComplexNumber[] = Array.from({ length: STATE_SIZE }, () => ({ real: 0, imaginary: 0 }));
  state[0] = { real: 1, imaginary: 0 };

  applyHadamard(state, 0);
  applyHadamard(state, 1);
  applyHadamard(state, 2);
  applyRy(state, 0, (clamp(input.riskScore, 0, 10) / 10) * Math.PI);
  if (input.residualRisk >= 4) applyPauliX(state, 1);
  if (!input.defenseSucceeded) applyPauliX(state, 2);
  if (input.confidence < 0.65) applyPauliZ(state, 2);
  if (familyFingerprint(input.attackFamily) % 2 === 0) applyCnot(state, 0, 1);
  applyCnot(state, 1, 2);
  applyHadamard(state, 2);

  const rawProbabilities = state.map((amplitude) => {
    const product = multiplyComplex(amplitude, { real: amplitude.real, imaginary: -amplitude.imaginary });
    return product.real;
  });
  const totalProbability = rawProbabilities.reduce((sum, probability) => sum + probability, 0) || 1;
  const stateProbabilities = rawProbabilities.map((probability) => Number((Math.max(0, probability) / totalProbability).toFixed(8)));
  const mostLikelyIndex = stateProbabilities.reduce(
    (bestIndex, probability, index, probabilities) => probability > probabilities[bestIndex]! ? index : bestIndex,
    0,
  );
  const riskAmplitude = Number(
    stateProbabilities.reduce((sum, probability, index) => sum + (index & 4 ? probability : 0), 0).toFixed(8),
  );
  const entropy = Number(
    (-stateProbabilities
      .filter((probability) => probability > 0)
      .reduce((sum, probability) => sum + probability * Math.log2(probability), 0) / Math.log2(STATE_SIZE)).toFixed(8),
  );
  const coherence = Number(
    clamp(
      state.reduce((sum, amplitude) => sum + Math.hypot(amplitude.real, amplitude.imaginary), 0) / Math.sqrt(STATE_SIZE),
      0,
      1,
    ).toFixed(8),
  );
  const confidence = Number(clamp(0.45 + (1 - entropy) * 0.25 + input.confidence * 0.3, 0.2, 0.95).toFixed(6));

  return {
    layer: "quantum",
    modelVersion: MODEL_VERSION,
    qubitCount: QUBIT_COUNT,
    measuredState: mostLikelyIndex.toString(2).padStart(QUBIT_COUNT, "0"),
    stateProbabilities,
    riskAmplitude,
    entropy,
    coherence,
    confidence,
  };
}