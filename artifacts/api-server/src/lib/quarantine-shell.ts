import { randomUUID } from "node:crypto";

export type QuarantineCaptureInput = {
  eventId: number;
  tenantId: number | null;
  event: string;
  score: number;
  action: string;
  status: string;
  severity: string;
  tactic: string | null;
  technique: string | null;
  techniqueId: string | null;
  velocityFlag: boolean;
  ruleMatches: string | null;
  hash: string;
  prevHash: string;
  nodeId: string;
};

/**
 * Builds a logical isolation envelope. This function deliberately does not
 * execute, deserialize, or interpret the event payload as code.
 */
export function buildQuarantineCapture(input: QuarantineCaptureInput) {
  return {
    isolationId: `quarantine-${randomUUID()}`,
    status: "QUARANTINED" as const,
    shellType: "LOGICAL_QUARANTINE" as const,
    reason: `Detection action ${input.action} exceeded the isolation threshold`,
    snapshot: {
      eventId: input.eventId,
      event: input.event,
      score: input.score,
      action: input.action,
      status: input.status,
      severity: input.severity,
      tactic: input.tactic,
      technique: input.technique,
      techniqueId: input.techniqueId,
      velocityFlag: input.velocityFlag,
      ruleMatches: input.ruleMatches,
      hash: input.hash,
      prevHash: input.prevHash,
      nodeId: input.nodeId,
      capturedAt: new Date().toISOString(),
      execution: "DISABLED",
      network: "DISABLED",
      hostAccess: "DISABLED",
    },
    executionAllowed: false as const,
  };
}