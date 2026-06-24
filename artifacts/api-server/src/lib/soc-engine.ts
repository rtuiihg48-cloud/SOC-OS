import crypto from "crypto";

export type Action = "ALLOW" | "WARN" | "ISOLATE" | "PATCHED";

export interface EventResult {
  event: string;
  score: number;
  action: Action;
  nodeId: string;
  hash: string;
  prevHash: string;
  cpuUsage?: number;
  memUsage?: number;
}

export interface Vulnerability {
  attack: string;
  score: number;
  action: string;
  fix: string | null;
}

const RISK_KEYWORDS: Record<string, number> = {
  inject: 10,
  exploit: 10,
  scan: 3,
  botnet: 10,
  bruteforce: 5,
  malware: 7,
  "auth bypass": 8,
  "privilege escalation": 9,
  "lateral movement": 8,
  exfiltration: 9,
  ransomware: 10,
  phishing: 4,
};

const SELF_RED_TEAM_ATTACKS = [
  "inject payload attempt",
  "auth bypass simulation",
  "network scan simulation",
  "privilege escalation attempt",
  "bruteforce login attempt",
  "malware execution simulation",
  "lateral movement detected",
  "data exfiltration attempt",
];

const AUTO_FIX_MAP: Array<{ pattern: string; fix: string }> = [
  { pattern: "inject", fix: "PATCH: input validation hardened" },
  { pattern: "auth", fix: "PATCH: MFA enforcement enabled" },
  { pattern: "scan", fix: "PATCH: rate limiting enabled" },
  { pattern: "bruteforce", fix: "PATCH: account lockout policy enforced" },
  { pattern: "malware", fix: "PATCH: process isolation hardened" },
  { pattern: "lateral", fix: "PATCH: network segmentation enforced" },
  { pattern: "exfil", fix: "PATCH: DLP rules activated" },
  { pattern: "privilege", fix: "PATCH: least-privilege policy enforced" },
];

export function scoreEvent(event: string, cpuUsage = 0, memUsage = 0): number {
  const lower = event.toLowerCase();
  let score = 0;
  for (const [keyword, weight] of Object.entries(RISK_KEYWORDS)) {
    if (lower.includes(keyword)) score += weight;
  }
  if (cpuUsage > 85) score += 5;
  if (memUsage > 85) score += 5;
  return score;
}

export function decideAction(score: number): Action {
  if (score >= 15) return "ISOLATE";
  if (score >= 7) return "WARN";
  return "ALLOW";
}

export function computeNodeId(event: string): string {
  return crypto.createHash("sha256").update(event).digest("hex").slice(0, 12);
}

export function computeHash(
  event: string,
  score: number,
  action: string,
  prevHash: string,
  timestamp: number,
): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ event, score, action, prevHash, timestamp }))
    .digest("hex");
}

export function autoFix(attack: string): string | null {
  const lower = attack.toLowerCase();
  for (const { pattern, fix } of AUTO_FIX_MAP) {
    if (lower.includes(pattern)) return fix;
  }
  return null;
}

export function getSelfRedTeamAttacks(): string[] {
  return SELF_RED_TEAM_ATTACKS;
}

export function runSelfRedTeam(
  prevHash: string,
): Array<{ result: EventResult; fix: string | null }> {
  const results: Array<{ result: EventResult; fix: string | null }> = [];
  let currentPrevHash = prevHash;

  for (const attack of SELF_RED_TEAM_ATTACKS) {
    const score = scoreEvent(attack, 90, 90);
    const action = decideAction(score);
    const ts = Date.now();
    const nodeId = computeNodeId(attack);
    const hash = computeHash(attack, score, action, currentPrevHash, ts);

    const result: EventResult = {
      event: attack,
      score,
      action,
      nodeId,
      hash,
      prevHash: currentPrevHash,
    };

    const fix = action === "ALLOW" ? autoFix(attack) : null;
    results.push({ result, fix });
    currentPrevHash = hash;
  }

  return results;
}
