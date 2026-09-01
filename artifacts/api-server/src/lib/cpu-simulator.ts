import crypto from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { analyzeEvent, autoFix, decideAction, severityFromScore } from "./soc-engine";
import { queueStats } from "./queue";
import { logger } from "./logger";
import { buildAttackLinkCandidates, type PriorAttackPrediction } from "./attack-memory-graph";
import { analyzeMarkovLayer, type MarkovAnalysis } from "./markov-layer";
import { analyzeQuantumLayer } from "./quantum-layer";
import { chooseStrategy, strategyCost, type StrategyDecision } from "./strategy-engine";

const MODEL_VERSION = "cpu-history-v2";
const STRATEGY_ISOLATION_VERSION = "global-synthetic-v2";
const LOCK_NAME = "soc-os:cpu-simulator";
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_INITIAL_DELAY_MS = 15_000;
const MIN_INTERVAL_MS = 15_000;

interface ScenarioTemplate {
  family: string;
  event: string;
  baseCpu: number;
  baseMemory: number;
}

interface HistoryFeature {
  sampleCount: number;
  averageRisk: number;
  averageConfidence: number;
  defenseSuccessRate: number;
  averageResidualRisk: number;
}

export interface CpuSimulationResult {
  cycleId: string;
  predictionId: number;
  attackFamily: string;
  riskScore: number;
  confidence: number;
  verificationStatus: "verified" | "rejected" | "inconclusive";
  defenseSucceeded: boolean;
  residualRisk: number;
  vulnerabilityPattern: string | null;
  linkCount: number;
  layerObservationCount: number;
  strategy: StrategyDecision;
  nodeRun: {
    node: "N2";
    status: "completed";
    quality: number;
    latencyMs: number;
    costUnits: number;
  };
}

const SCENARIOS: ScenarioTemplate[] = [
  {
    family: "credential_access",
    event: "synthetic credential dumping attempt against isolated identity telemetry",
    baseCpu: 68,
    baseMemory: 62,
  },
  {
    family: "initial_access",
    event: "synthetic phishing payload delivery observed in safe mail gateway logs",
    baseCpu: 42,
    baseMemory: 48,
  },
  {
    family: "privilege_escalation",
    event: "synthetic privilege escalation attempt represented as dry-run audit events",
    baseCpu: 76,
    baseMemory: 64,
  },
  {
    family: "lateral_movement",
    event: "synthetic lateral movement detected through simulated SMB relay telemetry",
    baseCpu: 72,
    baseMemory: 70,
  },
  {
    family: "exfiltration",
    event: "synthetic data exfiltration attempt represented in DNS tunnel telemetry",
    baseCpu: 66,
    baseMemory: 58,
  },
  {
    family: "impact",
    event: "synthetic ransomware encryption simulation against non-existent test data",
    baseCpu: 84,
    baseMemory: 80,
  },
  {
    family: "command_and_control",
    event: "synthetic c2 beaconing simulation represented as encrypted channel metadata",
    baseCpu: 60,
    baseMemory: 54,
  },
  {
    family: "discovery",
    event: "synthetic network scan simulation represented as generated service-discovery logs",
    baseCpu: 52,
    baseMemory: 44,
  },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseDuration(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_INTERVAL_MS, Math.floor(parsed));
}

async function loadHistory(client: PoolClient): Promise<Map<string, HistoryFeature>> {
  const result = await client.query<{
    attack_family: string;
    sample_count: number;
    average_risk: number;
    average_confidence: number;
    defense_success_rate: number;
    average_residual_risk: number;
  }>(`
    SELECT
      prediction.attack_family,
      COUNT(*)::int AS sample_count,
      COALESCE(AVG(prediction.risk_score), 0)::float8 AS average_risk,
      COALESCE(AVG(prediction.confidence), 0)::float8 AS average_confidence,
      COALESCE(
        AVG(CASE WHEN outcome.defense_succeeded THEN 1.0 ELSE 0.0 END)
          FILTER (WHERE outcome.prediction_id IS NOT NULL),
        0
      )::float8 AS defense_success_rate,
      COALESCE(AVG(outcome.residual_risk), 0)::float8 AS average_residual_risk
    FROM dna_predictions AS prediction
    LEFT JOIN LATERAL (
      SELECT prediction_id, defense_succeeded, residual_risk
      FROM dna_outcomes
      WHERE prediction_id = prediction.id
      ORDER BY created_at DESC
      LIMIT 1
    ) AS outcome ON TRUE
    WHERE prediction.created_at >= NOW() - INTERVAL '90 days'
      AND prediction.tenant_id IS NULL
      AND prediction.telemetry_snapshot->>'strategyIsolationVersion' = $1
    GROUP BY prediction.attack_family
  `, [STRATEGY_ISOLATION_VERSION]);

  return new Map(
    result.rows.map((row) => [
      row.attack_family,
      {
        sampleCount: Number(row.sample_count),
        averageRisk: Number(row.average_risk),
        averageConfidence: Number(row.average_confidence),
        defenseSuccessRate: Number(row.defense_success_rate),
        averageResidualRisk: Number(row.average_residual_risk),
      },
    ]),
  );
}

async function loadAttackSequence(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ attack_family: string }>(`
    SELECT attack_family
    FROM dna_predictions
    WHERE created_at >= NOW() - INTERVAL '90 days'
      AND tenant_id IS NULL
      AND telemetry_snapshot->>'strategyIsolationVersion' = $1
    ORDER BY created_at ASC, id ASC
  `, [STRATEGY_ISOLATION_VERSION]);
  return result.rows.map((row) => row.attack_family);
}

async function reconcilePendingOutcomes(client: PoolClient): Promise<number> {
  const pending = await client.query<{
    id: number;
    attack_family: string;
    risk_score: number;
    confidence: number;
    predicted_defense_succeeded: boolean;
    predicted_residual_risk: number;
    proposed_defense: string | null;
    predicted_action: string;
  }>(`
    SELECT
      prediction.id,
      prediction.attack_family,
      prediction.risk_score,
      prediction.confidence,
      prediction.predicted_defense_succeeded,
      prediction.predicted_residual_risk,
      prediction.proposed_defense,
      prediction.predicted_action
    FROM dna_predictions AS prediction
    WHERE NOT EXISTS (
      SELECT 1
      FROM dna_outcomes AS outcome
      WHERE outcome.prediction_id = prediction.id
    )
      AND prediction.tenant_id IS NULL
      AND prediction.telemetry_snapshot->>'strategyIsolationVersion' = $1
    ORDER BY prediction.created_at
    LIMIT 25
    FOR UPDATE SKIP LOCKED
  `, [STRATEGY_ISOLATION_VERSION]);

  for (const prediction of pending.rows) {
    const recoveryCoverage = clamp(
      (prediction.proposed_defense ? 0.58 : 0.16) +
        (prediction.predicted_action === "ISOLATE" ? 0.14 : 0),
      0.1,
      0.95,
    );
    const residualRisk = Math.max(0, Math.round(prediction.risk_score * (1 - recoveryCoverage)));
    const defenseSucceeded = residualRisk < 6;
    const verificationStatus = prediction.confidence < 0.5
      ? "inconclusive"
      : defenseSucceeded === prediction.predicted_defense_succeeded
        ? "verified"
        : "rejected";
    const vulnerabilityPattern = residualRisk >= 4
      ? `${prediction.attack_family}: recovered residual detection gap`
      : null;

    await client.query(`
      INSERT INTO dna_outcomes (
        prediction_id, source, verification_status, defense_action,
        defense_succeeded, residual_risk, vulnerability_pattern,
        reflection, details
      )
      SELECT $1, 'recovery', $2, $3, $4, $5, $6, $7, $8::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM dna_outcomes WHERE prediction_id = $1
      )
    `, [
      prediction.id,
      verificationStatus,
      prediction.proposed_defense,
      defenseSucceeded,
      residualRisk,
      vulnerabilityPattern,
      `Recovered the pending ${prediction.attack_family} simulation outcome after an interrupted cycle.`,
      JSON.stringify({
        controlCoverage: recoveryCoverage,
        predictedDefenseSucceeded: prediction.predicted_defense_succeeded,
        predictedResidualRisk: prediction.predicted_residual_risk,
        modelVersion: MODEL_VERSION,
        productionChanged: false,
        recovered: true,
      }),
    ]);
  }

  return pending.rowCount ?? 0;
}

async function linkPrediction(
  client: PoolClient,
  predictionId: number,
  scenario: ScenarioTemplate,
  prediction: ReturnType<typeof predictScenario>,
): Promise<number> {
  const previous = await client.query<{
    id: number;
    attack_family: string;
    tactic: string | null;
    technique_id: string | null;
    predicted_vulnerability: string | null;
    created_at: Date;
  }>(`
    SELECT id, attack_family, tactic, technique_id, predicted_vulnerability, created_at
    FROM dna_predictions
    WHERE id <> $1
      AND tenant_id IS NULL
      AND telemetry_snapshot->>'strategyIsolationVersion' = $2
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 50
  `, [predictionId, STRATEGY_ISOLATION_VERSION]);

  const priorPredictions: PriorAttackPrediction[] = previous.rows.map((row) => ({
    id: row.id,
    family: row.attack_family,
    tactic: row.tactic,
    techniqueId: row.technique_id,
    predictedVulnerability: row.predicted_vulnerability,
    createdAtMs: new Date(row.created_at).getTime(),
  }));
  const selected = buildAttackLinkCandidates(
    predictionId,
    {
      family: scenario.family,
      tactic: prediction.analysis.mitre?.tactic ?? null,
      techniqueId: prediction.analysis.mitre?.techniqueId ?? null,
      predictedVulnerability: prediction.predictedVulnerability,
    },
    priorPredictions,
    Date.now(),
  );

  for (const candidate of selected) {
    await client.query(`
      INSERT INTO dna_attack_links (
        from_prediction_id, to_prediction_id, link_type, confidence,
        evidence, explanation, model_version
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT (from_prediction_id, to_prediction_id, link_type) DO NOTHING
    `, [
      candidate.fromPredictionId,
      predictionId,
      candidate.linkType,
      candidate.confidence,
      JSON.stringify(candidate.evidence),
      candidate.explanation,
      MODEL_VERSION,
    ]);
  }

  return selected.length;
}

function selectScenario(
  history: Map<string, HistoryFeature>,
  markovRecommendation: string | null,
  strategy: StrategyDecision,
): ScenarioTemplate {
  const totalSamples = [...history.values()].reduce((sum, feature) => sum + feature.sampleCount, 0);
  const rotationIndex = totalSamples % SCENARIOS.length;

  return SCENARIOS
    .map((scenario, index) => {
      const feature = history.get(scenario.family);
      const sampleCount = feature?.sampleCount ?? 0;
       const explorationWeight = 2 / (sampleCount + 1) * (strategy.mode === "fast" ? 1.5 : 1);
       const vulnerabilityWeight = (1 - (feature?.defenseSuccessRate ?? 0.5)) * (strategy.mode === "deep" ? 4.2 : 3);
       const residualWeight = (feature?.averageResidualRisk ?? 0) / (strategy.mode === "deep" ? 7 : 10);
      const rotationWeight = index === rotationIndex ? 0.75 : 0;
      const markovWeight = scenario.family === markovRecommendation ? 1.2 : 0;
      return {
        scenario,
        priority: explorationWeight + vulnerabilityWeight + residualWeight + rotationWeight + markovWeight,
      };
    })
    .sort((left, right) => right.priority - left.priority)[0]!.scenario;
}

function predictScenario(
  scenario: ScenarioTemplate,
  feature: HistoryFeature | undefined,
  markovAnalysis: MarkovAnalysis | undefined,
) {
  const sampleCount = feature?.sampleCount ?? 0;
  const historicalPressure = Math.round((feature?.averageResidualRisk ?? 0) * 0.25);
  const cpuUsage = clamp(scenario.baseCpu + (sampleCount % 9), 0, 95);
  const memoryUsage = clamp(scenario.baseMemory + (sampleCount % 7), 0, 95);
  const analysis = analyzeEvent(scenario.event, cpuUsage, memoryUsage, { trackVelocity: false });
  const riskScore = Math.max(analysis.score, Math.round(feature?.averageRisk ?? 0)) + historicalPressure;
  const predictedAction = decideAction(riskScore);
  const proposedDefense = autoFix(scenario.event);
  const historyConfidence = Math.log10(sampleCount + 1) * 0.16;
  const stability = feature ? 1 - Math.min(0.25, Math.abs(feature.averageConfidence - 0.7)) : 0.75;
  const confidence = clamp(
    0.45 + historyConfidence + stability * 0.2 + (markovAnalysis?.confidence ?? 0) * 0.05,
    0.45,
    0.94,
  );
  const expectedCoverage = proposedDefense
    ? 0.58 + (feature?.defenseSuccessRate ?? 0.55) * 0.25 + (predictedAction === "ISOLATE" ? 0.12 : 0)
    : 0.18;
  const predictedResidualRisk = Math.max(0, Math.round(riskScore * (1 - clamp(expectedCoverage, 0, 0.95))));
  const predictedDefenseSucceeded = predictedResidualRisk < 6;
  const predictedVulnerability = predictedResidualRisk >= 4
    ? `${scenario.family}: predicted residual exposure after simulated controls`
    : null;

  return {
    analysis,
    riskScore,
    riskLevel: severityFromScore(riskScore),
    predictedAction,
    proposedDefense,
    confidence,
    predictedResidualRisk,
    predictedDefenseSucceeded,
    predictedVulnerability,
    cpuUsage,
    memoryUsage,
    historyFeatures: {
      sampleCount,
      averageRisk: feature?.averageRisk ?? 0,
      averageConfidence: feature?.averageConfidence ?? 0,
      defenseSuccessRate: feature?.defenseSuccessRate ?? 0,
      averageResidualRisk: feature?.averageResidualRisk ?? 0,
      markovTransitionProbability: markovAnalysis?.transitionProbability ?? 0,
      markovConfidence: markovAnalysis?.confidence ?? 0,
    },
  };
}

function simulateDefense(
  scenario: ScenarioTemplate,
  prediction: ReturnType<typeof predictScenario>,
) {
  const historySuccess = prediction.historyFeatures.defenseSuccessRate;
  const controlCoverage = clamp(
    (prediction.proposedDefense ? 0.58 : 0.16) +
      historySuccess * 0.18 +
      (prediction.predictedAction === "ISOLATE" ? 0.14 : 0) +
      (prediction.analysis.matches.length > 1 ? 0.05 : 0),
    0.1,
    0.95,
  );
  const residualRisk = Math.max(0, Math.round(prediction.riskScore * (1 - controlCoverage)));
  const defenseSucceeded = residualRisk < 6;
  const vulnerabilityPattern = residualRisk >= 4
    ? `${scenario.family}: ${residualRisk >= 8 ? "material" : "limited"} residual detection gap`
    : null;
  const verificationStatus = prediction.confidence < 0.5
    ? "inconclusive"
    : defenseSucceeded === prediction.predictedDefenseSucceeded
      ? "verified"
      : "rejected";
  const reflection = defenseSucceeded
    ? `Simulated controls reduced ${scenario.family} risk to ${residualRisk}; retain the defense pattern for future comparisons.`
    : `Simulated controls left residual risk ${residualRisk}; prioritize this pattern when generating future scenarios.`;

  return {
    defenseAction: prediction.proposedDefense,
    defenseSucceeded,
    residualRisk,
    vulnerabilityPattern,
    verificationStatus: verificationStatus as CpuSimulationResult["verificationStatus"],
    reflection,
    controlCoverage,
  };
}

async function begin(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
}

async function commit(client: PoolClient): Promise<void> {
  await client.query("COMMIT");
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

async function persistLayerObservation(
  client: PoolClient,
  predictionId: number,
  layerName: "markov" | "quantum",
  output: Record<string, unknown>,
  confidence: number,
  modelVersion: string,
): Promise<boolean> {
  await begin(client);
  try {
    await client.query(`
      INSERT INTO dna_prediction_layer_observations (
        prediction_id, layer_name, output, confidence, model_version
      )
      VALUES ($1, $2, $3::jsonb, $4, $5)
      ON CONFLICT (prediction_id, layer_name) DO NOTHING
    `, [predictionId, layerName, JSON.stringify(output), confidence, modelVersion]);
    await commit(client);
    return true;
  } catch (error) {
    await rollback(client);
    throw error;
  }
}

export async function runCpuSimulationCycle(options: { force?: boolean } = {}): Promise<CpuSimulationResult | null> {
  if (!options.force) {
    const queue = queueStats();
    if (queue.pending > 0 || queue.isProcessing) return null;
  }

  const client = await pool.connect();
  let lockAcquired = false;
  let transactionOpen = false;

  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) return null;

    const recoveredOutcomes = await reconcilePendingOutcomes(client);
    if (recoveredOutcomes > 0) {
      logger.warn({ recoveredOutcomes }, "Recovered pending CPU simulator outcomes");
    }

    const history = await loadHistory(client);
    const attackSequence = await loadAttackSequence(client);
    let markovRecommendation: string | null = null;
    let markovConfidence = 0;
    try {
      const markov = attackSequence.length === 0
        ? null
        : analyzeMarkovLayer(
          attackSequence,
          attackSequence.at(-1)!,
          SCENARIOS.map((candidate) => candidate.family),
        ).predictedNextFamily;
      markovRecommendation = markov;
      if (attackSequence.length > 0) {
        markovConfidence = analyzeMarkovLayer(
          attackSequence,
          attackSequence.at(-1)!,
          SCENARIOS.map((candidate) => candidate.family),
        ).confidence;
      }
    } catch (error) {
      logger.warn({ error }, "Markov layer recommendation failed; using history selector");
    }

    const historyFeatures = [...history.values()];
    const strategy = chooseStrategy({
      totalSamples: historyFeatures.reduce((sum, feature) => sum + feature.sampleCount, 0),
      lowestDefenseSuccessRate: historyFeatures.length > 0
        ? Math.min(...historyFeatures.map((feature) => feature.defenseSuccessRate))
        : 0,
      highestResidualRisk: historyFeatures.length > 0
        ? Math.max(...historyFeatures.map((feature) => feature.averageResidualRisk))
        : 0,
      markovConfidence,
    });
    const scenario = selectScenario(history, markovRecommendation, strategy);
    const feature = history.get(scenario.family);
    let markovAnalysis: MarkovAnalysis | undefined;
    try {
      markovAnalysis = analyzeMarkovLayer(
        attackSequence,
        scenario.family,
        SCENARIOS.map((candidate) => candidate.family),
      );
    } catch (error) {
      logger.warn({ error, attackFamily: scenario.family }, "Markov layer analysis failed");
    }
    const prediction = predictScenario(scenario, feature, markovAnalysis);
    const cycleId = crypto.randomUUID();
    const startedAt = Date.now();

    await begin(client);
    transactionOpen = true;
    const insertedPrediction = await client.query<{ id: number }>(`
      INSERT INTO dna_predictions (
        cycle_id, tenant_id, attack_family, scenario, tactic, technique,
        technique_id, risk_score, risk_level, confidence, predicted_action,
        proposed_defense, predicted_defense_succeeded, predicted_residual_risk,
        predicted_vulnerability, telemetry_snapshot, history_features,
        observer_note, model_version, prediction_status
      )
      VALUES (
        $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18, 'predicted'
      )
      RETURNING id
    `, [
      cycleId,
      scenario.family,
      scenario.event,
      prediction.analysis.mitre?.tactic ?? null,
      prediction.analysis.mitre?.technique ?? null,
      prediction.analysis.mitre?.techniqueId ?? null,
      prediction.riskScore,
      prediction.riskLevel,
      prediction.confidence,
      prediction.predictedAction,
      prediction.proposedDefense,
      prediction.predictedDefenseSucceeded,
      prediction.predictedResidualRisk,
      prediction.predictedVulnerability,
      JSON.stringify({
        cpuUsage: prediction.cpuUsage,
        memoryUsage: prediction.memoryUsage,
        synthetic: true,
        source: "cpu_idle_simulator",
         strategyMode: strategy.mode,
         strategyReason: strategy.reason,
         strategyConfidence: strategy.confidence,
         computeBudget: strategy.computeBudget,
         allocationNode: strategy.allocationNode,
         computeNode: strategy.computeNode,
         learningNode: strategy.learningNode,
         strategyIsolationVersion: STRATEGY_ISOLATION_VERSION,
      }),
      JSON.stringify(prediction.historyFeatures),
       `Observer recorded a synthetic ${scenario.family} forecast using ${strategy.mode} strategy: ${strategy.reason} Production systems were not changed.`,
      MODEL_VERSION,
    ]);
    await commit(client);
    transactionOpen = false;

    const predictionId = Number(insertedPrediction.rows[0]!.id);
    const outcome = simulateDefense(scenario, prediction);
    let layerObservationCount = 0;

    if (markovAnalysis) {
      try {
        if (await persistLayerObservation(
          client,
          predictionId,
          "markov",
          markovAnalysis as unknown as Record<string, unknown>,
          markovAnalysis.confidence,
          markovAnalysis.modelVersion,
        )) {
          layerObservationCount += 1;
        }
      } catch (error) {
        logger.warn({ error, predictionId }, "Failed to persist Markov layer observation");
      }
    }

    try {
      const quantumAnalysis = analyzeQuantumLayer({
        attackFamily: scenario.family,
        riskScore: prediction.riskScore,
        confidence: prediction.confidence,
        defenseSucceeded: outcome.defenseSucceeded,
        residualRisk: outcome.residualRisk,
      });
      if (await persistLayerObservation(
        client,
        predictionId,
        "quantum",
        quantumAnalysis as unknown as Record<string, unknown>,
        quantumAnalysis.confidence,
        quantumAnalysis.modelVersion,
      )) {
        layerObservationCount += 1;
      }
    } catch (error) {
      logger.warn({ error, predictionId }, "Failed to persist quantum layer observation");
    }

    await begin(client);
    transactionOpen = true;
    await client.query(`
      INSERT INTO dna_outcomes (
        prediction_id, source, verification_status, defense_action,
        defense_succeeded, residual_risk, vulnerability_pattern,
        reflection, details
      )
      VALUES ($1, 'simulation', $2, $3, $4, $5, $6, $7, $8::jsonb)
    `, [
      predictionId,
      outcome.verificationStatus,
      outcome.defenseAction,
      outcome.defenseSucceeded,
      outcome.residualRisk,
      outcome.vulnerabilityPattern,
      outcome.reflection,
      JSON.stringify({
        controlCoverage: outcome.controlCoverage,
        predictedDefenseSucceeded: prediction.predictedDefenseSucceeded,
        predictedResidualRisk: prediction.predictedResidualRisk,
        modelVersion: MODEL_VERSION,
        productionChanged: false,
      }),
    ]);
    await commit(client);
    transactionOpen = false;

    let linkCount = 0;
    try {
      linkCount = await linkPrediction(client, predictionId, scenario, prediction);
    } catch (error) {
      logger.warn({ error, predictionId }, "Failed to extend DNA attack graph");
    }

    const latencyMs = Math.max(1, Date.now() - startedAt);
    const quality = clamp(
      prediction.confidence * 0.65 + (outcome.defenseSucceeded ? 0.35 : 0),
      0,
      1,
    );
    return {
      cycleId,
      predictionId,
      attackFamily: scenario.family,
      riskScore: prediction.riskScore,
      confidence: prediction.confidence,
      verificationStatus: outcome.verificationStatus,
      defenseSucceeded: outcome.defenseSucceeded,
      residualRisk: outcome.residualRisk,
      vulnerabilityPattern: outcome.vulnerabilityPattern,
      linkCount,
      layerObservationCount,
      strategy,
      nodeRun: {
        node: "N2",
        status: "completed",
        quality,
        latencyMs,
        costUnits: strategyCost(strategy.mode),
      },
    };
  } catch (error) {
    if (transactionOpen) await rollback(client);
    throw error;
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]).catch((error) => {
        logger.error({ error }, "Failed to release CPU simulator advisory lock");
      });
    }
    client.release();
  }
}

export class CpuSimulatorScheduler {
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private stopped = true;

  start(): void {
    if (this.timer || process.env.CPU_SIMULATOR_ENABLED === "false") {
      if (process.env.CPU_SIMULATOR_ENABLED === "false") {
        logger.info("CPU simulator disabled by kill switch");
      }
      return;
    }

    this.stopped = false;
    const intervalMs = parseDuration(process.env.CPU_SIMULATOR_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    const initialDelayMs = parseDuration(process.env.CPU_SIMULATOR_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);

    const tick = async () => {
      if (this.activeCycle || this.stopped) return;
      this.activeCycle = (async () => {
      try {
        const result = await runCpuSimulationCycle();
        if (result) {
          logger.info({
            predictionId: result.predictionId,
            attackFamily: result.attackFamily,
            riskScore: result.riskScore,
            confidence: result.confidence,
            verificationStatus: result.verificationStatus,
            residualRisk: result.residualRisk,
            linkCount: result.linkCount,
            layerObservationCount: result.layerObservationCount,
          }, "CPU red-team/blue-team simulation stored in DNA memory");
        }
      } catch (error) {
        logger.error({ error }, "CPU simulator cycle failed");
      } finally {
        this.activeCycle = null;
      }
      })();
      await this.activeCycle;
    };

    this.timer = setTimeout(() => {
      if (this.stopped) return;
      void tick();
      this.timer = setInterval(() => void tick(), intervalMs);
    }, initialDelayMs);

    logger.info({ intervalMs, initialDelayMs, modelVersion: MODEL_VERSION }, "CPU simulator scheduler started");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.activeCycle) await this.activeCycle;
  }
}