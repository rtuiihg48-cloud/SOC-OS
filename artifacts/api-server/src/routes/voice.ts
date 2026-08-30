import { Router } from "express";
import express from "express";
import {
  detectAudioFormat,
  ensureCompatibleFormat,
  isSupportedAudioMimeType,
  speechToText,
} from "@workspace/integrations-openai-ai-server/audio";
import {
  db,
  virusCatalogEntriesTable,
  virusDatabaseAuditTable,
  virusFamiliesTable,
  virusIndicatorsTable,
  virusSamplesTable,
} from "@workspace/db";
import { ExecuteVoiceCommandBody, PreviewVoiceCommandBody } from "@workspace/api-zod";
import { and, count, eq, ilike } from "drizzle-orm";
import { autoFix, buildEventResult } from "../lib/soc-engine";

const router = Router();
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const SHA256 = /\b[0-9a-f]{64}\b/i;
const ALL_CRITERIA = ["SHA256", "SAMPLE_ID", "FAMILY", "SEVERITY", "INDICATOR_TYPE"] as const;
type CriterionType = (typeof ALL_CRITERIA)[number];
type Criterion = { type: CriterionType; value: string | null };

type VoicePlan = {
  intent: "TEST_VIRUS" | "SIMULATE_DEFENSE";
  label: string;
  mode: "TARGETED" | "MATRIX" | "SYNTHETIC";
  criteria: Criterion[];
  requiresConfirmation: true;
  executionAllowed: false;
  safetyNotes: string[];
};

const SYNTHETIC_DEFENSE_SCENARIOS = [
  "synthetic malware c2 beaconing simulation via encrypted channel",
  "synthetic ransomware encryption simulation on managed data — blocked",
  "synthetic malware persistence attempt via startup configuration",
  "synthetic credential dumping attempt from isolated memory image",
] as const;

function principal(req: { get(name: string): string | undefined }) {
  return req.get("x-principal-ref")?.slice(0, 200) || "voice:anonymous";
}

function parseCriteria(transcript: string): Criterion[] {
  const criteria: Criterion[] = [];
  const hash = transcript.match(SHA256)?.[0]?.toLowerCase();
  const sampleId = transcript.match(/(?:sample|зраз(?:ок|ка)|id)\s*#?\s*(\d+)/iu)?.[1];
  const family = transcript.match(/(?:family|сімейств(?:о|а|у)?|родин(?:а|и|у)?)\s*[:=]?\s*([\p{L}\p{N}._-]{2,80})/iu)?.[1];
  const severityMatch = transcript.match(/\b(critical|high|medium|low|критичн\w*|висок\w*|середн\w*|низьк\w*)\b/iu)?.[1]?.toLowerCase();

  if (hash) criteria.push({ type: "SHA256", value: hash });
  if (sampleId) criteria.push({ type: "SAMPLE_ID", value: sampleId });
  if (family) criteria.push({ type: "FAMILY", value: family });
  if (severityMatch) {
    const severity =
      severityMatch.startsWith("крит") ? "CRITICAL" :
      severityMatch.startsWith("вис") ? "HIGH" :
      severityMatch.startsWith("серед") ? "MEDIUM" :
      severityMatch.startsWith("низ") ? "LOW" :
      severityMatch.toUpperCase();
    criteria.push({ type: "SEVERITY", value: severity });
  }

  const indicatorType =
    /byte[\s_-]?fingerprint|відбит\w*\s+байт/iu.test(transcript) ? "BYTE_FINGERPRINT" :
    /signature|сигнатур/iu.test(transcript) ? "SIGNATURE" :
    /\bsha(?:-?256)?\b/iu.test(transcript) && !hash ? "SHA256" :
    null;
  if (indicatorType && !criteria.some(({ type }) => type === "INDICATOR_TYPE")) {
    criteria.push({ type: "INDICATOR_TYPE", value: indicatorType });
  }

  return criteria;
}

function parseVoicePlan(rawTranscript: string): VoicePlan | null {
  const transcript = rawTranscript.trim();
  if (
    /(?:симул|іміту|зіміту|створ).*(?:вірус|malware).*(?:відб|захист|defend|repel)|(?:відб|захист|defend|repel).*(?:вірус|malware)/iu.test(transcript)
  ) {
    return {
      intent: "SIMULATE_DEFENSE",
      label: "Simulate synthetic viruses and defend",
      mode: "SYNTHETIC",
      criteria: [],
      requiresConfirmation: true,
      executionAllowed: false,
      safetyNotes: [
        "Only harmless text scenarios are generated.",
        "No binary, shell, network, host, VM, or META-CUBE execution is allowed.",
        "Synthetic results never enter the live event stream.",
      ],
    };
  }

  if (/(?:протест|перевір|тест).*(?:вірус|malware)|(?:вірус|malware).*(?:протест|перевір|тест)/iu.test(transcript)) {
    const parsedCriteria = parseCriteria(transcript);
    const criteria = parsedCriteria.length > 0
      ? parsedCriteria
      : ALL_CRITERIA.map((type) => ({ type, value: null }));
    return {
      intent: "TEST_VIRUS",
      label: parsedCriteria.length > 0 ? "Test virus by selected criteria" : "Run full virus criteria matrix",
      mode: parsedCriteria.length > 0 ? "TARGETED" : "MATRIX",
      criteria,
      requiresConfirmation: true,
      executionAllowed: false,
      safetyNotes: [
        "Metadata and indicators only; sample bytes are never loaded.",
        "Every criterion is evaluated independently and recorded in the audit log.",
        "No binary, shell, LLM, network, host, VM, or META-CUBE execution is allowed.",
      ],
    };
  }

  return null;
}

async function runCriterion(criterion: Criterion) {
  let valueCount = 0;
  let evidence = "";

  if (criterion.type === "SHA256") {
    const [row] = await db
      .select({ value: count() })
      .from(virusIndicatorsTable)
      .where(and(
        eq(virusIndicatorsTable.indicatorType, "SHA256"),
        eq(virusIndicatorsTable.status, "ACTIVE"),
        criterion.value ? eq(virusIndicatorsTable.normalizedValue, criterion.value) : undefined,
      ));
    valueCount = row.value;
    evidence = criterion.value ? "Exact active SHA-256 indicator lookup" : "Active SHA-256 indicator inventory";
  } else if (criterion.type === "SAMPLE_ID") {
    const sampleId = criterion.value ? Number(criterion.value) : null;
    const [row] = await db
      .select({ value: count() })
      .from(virusSamplesTable)
      .where(sampleId ? eq(virusSamplesTable.id, sampleId) : undefined);
    valueCount = row.value;
    evidence = criterion.value ? "Quarantined sample metadata lookup" : "Registered sample metadata inventory";
  } else if (criterion.type === "FAMILY") {
    const [row] = await db
      .select({ value: count() })
      .from(virusFamiliesTable)
      .where(criterion.value ? ilike(virusFamiliesTable.canonicalName, `%${criterion.value}%`) : undefined);
    valueCount = row.value;
    evidence = criterion.value ? "Canonical family and alias-safe metadata lookup" : "Known virus family inventory";
  } else if (criterion.type === "SEVERITY") {
    const [row] = await db
      .select({ value: count() })
      .from(virusCatalogEntriesTable)
      .where(criterion.value ? eq(virusCatalogEntriesTable.severity, criterion.value) : undefined);
    valueCount = row.value;
    evidence = criterion.value ? "Catalog severity classification lookup" : "Catalog severity inventory";
  } else {
    const [row] = await db
      .select({ value: count() })
      .from(virusIndicatorsTable)
      .where(and(
        eq(virusIndicatorsTable.status, "ACTIVE"),
        criterion.value ? eq(virusIndicatorsTable.indicatorType, criterion.value) : undefined,
      ));
    valueCount = row.value;
    evidence = criterion.value ? "Active indicator type lookup" : "Active SHA, byte fingerprint, and signature inventory";
  }

  return {
    ...criterion,
    status: criterion.value ? (valueCount > 0 ? "MATCH" as const : "NO_MATCH" as const) : "AVAILABLE" as const,
    count: valueCount,
    evidence,
  };
}

function recommendedActionFor(criteria: Criterion[], hasMatch: boolean): "ALLOW" | "WARN" | "ISOLATE" {
  const severity = criteria.find(({ type }) => type === "SEVERITY")?.value;
  if (severity === "CRITICAL" || severity === "HIGH") return hasMatch ? "ISOLATE" : "ALLOW";
  if (hasMatch) return "WARN";
  return "ALLOW";
}

router.post(
  "/voice/transcribe",
  express.raw({
    type: ["audio/*", "application/octet-stream"],
    limit: MAX_AUDIO_BYTES,
  }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Audio payload is required" });
      return;
    }

    const detectedFormat = detectAudioFormat(req.body);
    const declaredContentType = req.header("content-type") ?? undefined;
    if (detectedFormat === "unknown" && !isSupportedAudioMimeType(declaredContentType)) {
      res.status(415).json({
        error: "Unsupported audio format. Use WAV, MP3, WebM, MP4, OGG, or AAC audio.",
      });
      return;
    }

    try {
      const { buffer, format } = await ensureCompatibleFormat(req.body);
      const transcript = (await speechToText(buffer, format)).trim();

      res.json({
        transcript,
        format,
        audioStored: false,
      });
    } catch (error) {
      req.log?.error({ err: error }, "Voice transcription failed");
      if (detectedFormat === "unknown") {
        res.status(415).json({
          error: "The audio file is damaged or its container cannot be decoded.",
        });
        return;
      }
      res.status(502).json({ error: "Voice transcription is unavailable" });
    }
  },
);

router.post("/voice/commands/preview", async (req, res) => {
  const parsed = PreviewVoiceCommandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid voice command transcript" });
    return;
  }
  const plan = parseVoicePlan(parsed.data.transcript);
  if (!plan) {
    res.status(400).json({ error: "Unsupported voice command" });
    return;
  }
  res.json(plan);
});

router.post("/voice/commands/execute", async (req, res) => {
  const parsed = ExecuteVoiceCommandBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmed !== true) {
    res.status(400).json({ error: "A valid, explicitly confirmed command is required" });
    return;
  }

  const plan = parseVoicePlan(parsed.data.transcript);
  if (!plan) {
    res.status(400).json({ error: "Unsupported voice command" });
    return;
  }

  if (plan.intent === "TEST_VIRUS") {
    const criteriaResults = await Promise.all(plan.criteria.map(runCriterion));
    const hasMatch = criteriaResults.some(({ status }) => status === "MATCH");
    const recommendedAction = recommendedActionFor(plan.criteria, hasMatch);
    await db.insert(virusDatabaseAuditTable).values({
      action: "VOICE_VIRUS_TEST",
      entityType: "voice_command",
      principalRef: principal(req),
      outcome: "COMPLETED",
      details: {
        mode: plan.mode,
        criteria: criteriaResults,
        recommendedAction,
        executionAllowed: false,
      },
    });
    res.json({
      intent: plan.intent,
      status: "COMPLETED",
      summary: `${criteriaResults.length} virus criteria checks completed; ${criteriaResults.filter(({ status }) => status === "MATCH").length} targeted matches found.`,
      recommendedAction,
      criteriaResults,
      syntheticDefense: [],
      executionAllowed: false,
      auditRecorded: true,
    });
    return;
  }

  let previousHash = "SYNTHETIC_GENESIS";
  const syntheticDefense = SYNTHETIC_DEFENSE_SCENARIOS.map((scenario) => {
    const result = buildEventResult(scenario, previousHash, 90, 90);
    previousHash = result.hash;
    const fix = autoFix(scenario);
    return {
      scenario,
      riskScore: result.score,
      action: result.action as "ALLOW" | "WARN" | "ISOLATE",
      response: fix ?? (result.action === "ISOLATE" ? "LOGICAL_QUARANTINE" : "MONITOR_ONLY"),
      stages: [
        "GENERATED" as const,
        "DETECTED" as const,
        ...(result.action === "ISOLATE" ? ["QUARANTINED" as const] : []),
        "RESPONDED" as const,
      ],
    };
  });
  const recommendedAction = syntheticDefense.some(({ action }) => action === "ISOLATE") ? "ISOLATE" as const : "WARN" as const;
  await db.insert(virusDatabaseAuditTable).values({
    action: "VOICE_SYNTHETIC_DEFENSE",
    entityType: "voice_command",
    principalRef: principal(req),
    outcome: "COMPLETED",
    details: {
      scenarioCount: syntheticDefense.length,
      recommendedAction,
      executionAllowed: false,
      persistedToLiveEvents: false,
    },
  });
  res.json({
    intent: plan.intent,
    status: "COMPLETED",
    summary: `${syntheticDefense.length} harmless synthetic virus scenarios detected and answered without payload execution.`,
    recommendedAction,
    criteriaResults: [],
    syntheticDefense,
    executionAllowed: false,
    auditRecorded: true,
  });
});

export default router;