import { db, rulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Action } from "./soc-engine";

export interface RuleMatch {
  ruleId: number;
  ruleName: string;
  scoreBoost: number;
  forceAction: Action | null;
  severity: string;
}

export interface RulesResult {
  totalBoost: number;
  forcedAction: Action | null;
  matches: RuleMatch[];
}

// ─── Apply DB-stored rules to an event ────────────────────────────────────────
// Rules are loaded fresh each call (cached in production would use Redis).
// Any rule can boost the score AND/OR force a specific action regardless of score.
// Multiple ISOLATE rules stack — last forcedAction wins if both WARN and ISOLATE match.
export async function applyRules(
  event: string,
  tenantId: number | null,
): Promise<RulesResult> {
  const conditions = [eq(rulesTable.enabled, true)];
  if (tenantId !== null) {
    conditions.push(eq(rulesTable.tenantId, tenantId));
  }

  const rules = await db
    .select()
    .from(rulesTable)
    .where(and(...conditions));

  const lower = event.toLowerCase();
  let totalBoost = 0;
  let forcedAction: Action | null = null;
  const matches: RuleMatch[] = [];

  for (const rule of rules) {
    const pattern = rule.matchPattern.toLowerCase();
    if (lower.includes(pattern)) {
      totalBoost += rule.scoreBoost;

      const fa = rule.forceAction as Action | null;
      // ISOLATE always takes priority over WARN
      if (fa === "ISOLATE" || (fa === "WARN" && forcedAction !== "ISOLATE")) {
        forcedAction = fa;
      }

      matches.push({
        ruleId: rule.id,
        ruleName: rule.name,
        scoreBoost: rule.scoreBoost,
        forceAction: fa,
        severity: rule.severity,
      });

      // Increment hit count
      db.update(rulesTable)
        .set({ hitCount: rule.hitCount + 1 })
        .where(eq(rulesTable.id, rule.id))
        .execute()
        .catch(() => {});
    }
  }

  return { totalBoost, forcedAction, matches };
}

// ─── Default system rules (seeded on first run) ───────────────────────────────
export const DEFAULT_SYSTEM_RULES: Array<{
  name: string;
  description: string;
  matchPattern: string;
  scoreBoost: number;
  forceAction: string | null;
  severity: string;
}> = [
  {
    name: "Privilege Escalation Force Isolate",
    description: "Any privilege escalation attempt immediately isolates the host",
    matchPattern: "privilege escalation",
    scoreBoost: 8,
    forceAction: "ISOLATE",
    severity: "critical",
  },
  {
    name: "Data Exfiltration Critical",
    description: "Data exfiltration triggers immediate isolation",
    matchPattern: "data exfiltration",
    scoreBoost: 10,
    forceAction: "ISOLATE",
    severity: "critical",
  },
  {
    name: "Multiple Login Failures",
    description: "Repeated failed logins boost score and force WARN",
    matchPattern: "multiple login fail",
    scoreBoost: 4,
    forceAction: "WARN",
    severity: "medium",
  },
  {
    name: "Ransomware Signature",
    description: "Any ransomware pattern forces immediate isolation",
    matchPattern: "ransomware",
    scoreBoost: 10,
    forceAction: "ISOLATE",
    severity: "critical",
  },
  {
    name: "XSS Injection Boost",
    description: "XSS patterns boost score for cross-site scripting",
    matchPattern: "xss",
    scoreBoost: 5,
    forceAction: "WARN",
    severity: "high",
  },
  {
    name: "C2 Beaconing Warning",
    description: "Command-and-control beaconing forced to WARN minimum",
    matchPattern: "beaconing",
    scoreBoost: 3,
    forceAction: "WARN",
    severity: "high",
  },
];
