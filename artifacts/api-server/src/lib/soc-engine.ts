import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────
export type Action = "ALLOW" | "WARN" | "ISOLATE" | "PATCHED";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AlertStatus = "NEW" | "ACKNOWLEDGED" | "INVESTIGATING" | "RESOLVED";

export interface MitreMapping {
  tactic: string;
  technique: string;
  techniqueId: string;
}

export interface EventResult {
  event: string;
  score: number;
  action: Action;
  severity: Severity;
  matches: string[];        // which rule IDs fired (from security-core concept)
  nodeId: string;
  hash: string;
  prevHash: string;
  tactic: string | null;
  technique: string | null;
  techniqueId: string | null;
  velocityFlag: boolean;
  cpuUsage?: number;
  memUsage?: number;
}

// ─── Security Core Rules (Regex-based, from security-core.ts V1 concept) ─────
// Upgraded from simple string.includes() → precise regex patterns.
// Each rule has: id (for the "matches" field), pattern (RegExp), score weight,
// and optional MITRE ATT&CK mapping.
interface SecurityRule {
  id: string;
  pattern: RegExp;
  score: number;
  mitre?: MitreMapping;
}

const SECURITY_RULES: SecurityRule[] = [
  {
    id: "injection",
    pattern: /(sql.*inject|union select|inject|payload)/i,
    score: 10,
    mitre: { tactic: "Initial Access", technique: "Exploit Public-Facing Application", techniqueId: "T1190" },
  },
  {
    id: "exploit",
    pattern: /\bexploit\b/i,
    score: 10,
    mitre: { tactic: "Execution", technique: "Exploitation for Client Execution", techniqueId: "T1203" },
  },
  {
    id: "scan",
    pattern: /\b(scan|port.?scan|nmap|recon)\b/i,
    score: 3,
    mitre: { tactic: "Discovery", technique: "Network Service Discovery", techniqueId: "T1046" },
  },
  {
    id: "bruteforce",
    pattern: /\b(bruteforce|brute.?force|password.?spray)\b/i,
    score: 6,
    mitre: { tactic: "Credential Access", technique: "Brute Force", techniqueId: "T1110" },
  },
  {
    id: "malware",
    pattern: /\bmalware\b/i,
    score: 8,
    mitre: { tactic: "Execution", technique: "User Execution", techniqueId: "T1204" },
  },
  {
    id: "xss",
    pattern: /\bxss\b/i,
    score: 5,
    mitre: { tactic: "Initial Access", technique: "Drive-by Compromise", techniqueId: "T1189" },
  },
  {
    id: "sql_injection",
    pattern: /(sql.*inject|union\s+select)/i,
    score: 7,
    mitre: { tactic: "Initial Access", technique: "Exploit Public-Facing Application", techniqueId: "T1190" },
  },
  {
    id: "ransomware",
    pattern: /\bransomware\b/i,
    score: 10,
    mitre: { tactic: "Impact", technique: "Data Encrypted for Impact", techniqueId: "T1486" },
  },
  {
    id: "auth_bypass",
    pattern: /(auth.?bypass|jwt.?manip|token.?forge)/i,
    score: 8,
    mitre: { tactic: "Defense Evasion", technique: "Abuse Elevation Control Mechanism", techniqueId: "T1548" },
  },
  {
    id: "privilege_escalation",
    pattern: /(privilege.?escal|sudo.?exploit|privesc)/i,
    score: 9,
    mitre: { tactic: "Privilege Escalation", technique: "Exploitation for Privilege Escalation", techniqueId: "T1068" },
  },
  {
    id: "lateral_movement",
    pattern: /(lateral.?move|smb.?relay|pass.?the.?hash|wmi.?exec)/i,
    score: 8,
    mitre: { tactic: "Lateral Movement", technique: "Remote Services", techniqueId: "T1021" },
  },
  {
    id: "exfiltration",
    pattern: /(exfil|data.?exfil|dns.?tunnel)/i,
    score: 9,
    mitre: { tactic: "Exfiltration", technique: "Exfiltration Over C2 Channel", techniqueId: "T1041" },
  },
  {
    id: "phishing",
    pattern: /\bphishing\b/i,
    score: 4,
    mitre: { tactic: "Initial Access", technique: "Phishing", techniqueId: "T1566" },
  },
  {
    id: "credential_dump",
    pattern: /(credential.?dump|lsass|\/proc\/mem)/i,
    score: 9,
    mitre: { tactic: "Credential Access", technique: "OS Credential Dumping", techniqueId: "T1003" },
  },
  {
    id: "rootkit",
    pattern: /\brootkit\b/i,
    score: 9,
    mitre: { tactic: "Defense Evasion", technique: "Rootkit", techniqueId: "T1014" },
  },
  {
    id: "backdoor",
    pattern: /\bbackdoor\b/i,
    score: 8,
    mitre: { tactic: "Persistence", technique: "Server Software Component", techniqueId: "T1505" },
  },
  {
    id: "ddos",
    pattern: /\b(ddos|dos.?attack|flood)\b/i,
    score: 7,
    mitre: { tactic: "Impact", technique: "Network Denial of Service", techniqueId: "T1498" },
  },
  {
    id: "c2_communication",
    pattern: /(c2.?beacon|command.?control|beaconing)/i,
    score: 8,
    mitre: { tactic: "Command and Control", technique: "Encrypted Channel", techniqueId: "T1573" },
  },
  {
    id: "botnet",
    pattern: /\bbotnet\b/i,
    score: 10,
    mitre: { tactic: "Command and Control", technique: "Application Layer Protocol", techniqueId: "T1071" },
  },
];

// ─── Severity from Score (security-core.ts logic) ────────────────────────────
export function severityFromScore(score: number): Severity {
  if (score >= 15) return "CRITICAL";
  if (score >= 10) return "HIGH";
  if (score >= 5) return "MEDIUM";
  return "LOW";
}

// ─── Action from Score ────────────────────────────────────────────────────────
export function decideAction(score: number): Action {
  if (score >= 15) return "ISOLATE";
  if (score >= 7) return "WARN";
  return "ALLOW";
}

// ─── Evaluate rules (security-core.ts evaluateRules concept) ─────────────────
// Returns total score, list of matched rule IDs, and the top MITRE mapping.
function evaluateRules(event: string): {
  score: number;
  matches: string[];
  topMitre: MitreMapping | null;
  velocityKey: string;
} {
  let score = 0;
  const matches: string[] = [];
  let topMitre: MitreMapping | null = null;
  let topWeight = 0;
  let velocityKey = "unknown";

  for (const rule of SECURITY_RULES) {
    if (rule.pattern.test(event)) {
      score += rule.score;
      matches.push(rule.id);
      if (rule.score > topWeight) {
        topWeight = rule.score;
        topMitre = rule.mitre ?? null;
        velocityKey = rule.id;
      }
    }
  }

  return { score, matches, topMitre, velocityKey };
}

// ─── Velocity / Burst Detection ───────────────────────────────────────────────
// Tracks event type frequency in a 60s sliding window.
// Burst ≥ 3 same type in 60s → velocityFlag = true, +5 score.
interface VelocityEntry {
  count: number;
  windowStart: number;
}

const velocityCache = new Map<string, VelocityEntry>();
const VELOCITY_WINDOW_MS = 60_000;
const VELOCITY_BURST_THRESHOLD = 3;
const VELOCITY_BONUS = 5;

function checkVelocity(key: string): boolean {
  const now = Date.now();
  const entry = velocityCache.get(key);

  if (!entry || now - entry.windowStart > VELOCITY_WINDOW_MS) {
    velocityCache.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count >= VELOCITY_BURST_THRESHOLD;
}

// ─── Auto-Fix (SOAR) Patterns ─────────────────────────────────────────────────
const AUTO_FIX_MAP: Array<{ ruleId: string; fix: string }> = [
  { ruleId: "injection",            fix: "PATCH: input validation hardened" },
  { ruleId: "sql_injection",        fix: "PATCH: parameterized queries enforced" },
  { ruleId: "auth_bypass",          fix: "PATCH: MFA enforcement enabled" },
  { ruleId: "scan",                 fix: "PATCH: rate limiting enabled" },
  { ruleId: "bruteforce",           fix: "PATCH: account lockout policy enforced" },
  { ruleId: "malware",              fix: "PATCH: process isolation hardened" },
  { ruleId: "lateral_movement",     fix: "PATCH: network segmentation enforced" },
  { ruleId: "exfiltration",         fix: "PATCH: DLP rules activated" },
  { ruleId: "privilege_escalation", fix: "PATCH: least-privilege policy enforced" },
  { ruleId: "credential_dump",      fix: "PATCH: credential rotation triggered" },
  { ruleId: "rootkit",              fix: "PATCH: kernel integrity check enforced" },
  { ruleId: "backdoor",             fix: "PATCH: endpoint isolation initiated" },
  { ruleId: "ddos",                 fix: "PATCH: traffic scrubbing activated" },
  { ruleId: "c2_communication",     fix: "PATCH: egress filtering enforced" },
  { ruleId: "ransomware",           fix: "PATCH: backup isolation + snapshot triggered" },
  { ruleId: "phishing",             fix: "PATCH: email gateway rules updated" },
  { ruleId: "xss",                  fix: "PATCH: output encoding enforced" },
  { ruleId: "botnet",               fix: "PATCH: C2 IP block list updated" },
];

export function autoFix(attack: string): string | null {
  const { matches } = evaluateRules(attack);
  if (matches.length === 0) return null;
  const entry = AUTO_FIX_MAP.find((f) => matches.includes(f.ruleId));
  return entry?.fix ?? null;
}

// ─── Core Pipeline Functions ──────────────────────────────────────────────────

export function analyzeEvent(
  event: string,
  cpuUsage = 0,
  memUsage = 0,
  options: { trackVelocity?: boolean } = {},
): {
  score: number;
  severity: Severity;
  matches: string[];
  mitre: MitreMapping | null;
  velocityFlag: boolean;
} {
  const { score: baseScore, matches, topMitre, velocityKey } = evaluateRules(event);

  let score = baseScore;

  // System stress bonus — high resource usage amplifies risk
  if (cpuUsage > 85) score += 5;
  if (memUsage > 85) score += 5;
  if (cpuUsage > 70 && memUsage > 70) score += 3;

  const velocityFlag = score > 0 && options.trackVelocity !== false ? checkVelocity(velocityKey) : false;
  if (velocityFlag) score += VELOCITY_BONUS;

  return {
    score,
    severity: severityFromScore(score),
    matches,
    mitre: topMitre,
    velocityFlag,
  };
}

export function computeNodeId(event: string): string {
  return crypto.createHash("sha256").update(event + Date.now()).digest("hex").slice(0, 12);
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

export function buildEventResult(
  event: string,
  prevHash: string,
  cpuUsage?: number,
  memUsage?: number,
): EventResult {
  const { score, severity, matches, mitre, velocityFlag } = analyzeEvent(event, cpuUsage ?? 0, memUsage ?? 0);
  const action = decideAction(score);
  const ts = Date.now();
  const nodeId = computeNodeId(event);
  const hash = computeHash(event, score, action, prevHash, ts);

  return {
    event,
    score,
    action,
    severity,
    matches,
    nodeId,
    hash,
    prevHash,
    tactic: mitre?.tactic ?? null,
    technique: mitre?.technique ?? null,
    techniqueId: mitre?.techniqueId ?? null,
    velocityFlag,
    cpuUsage,
    memUsage,
  };
}

export const SELF_RED_TEAM_ATTACKS = [
  "inject payload attempt on /api/users",
  "auth bypass simulation via JWT manipulation",
  "network scan simulation on port range 1-1024",
  "privilege escalation attempt via sudo exploit",
  "bruteforce login attempt on admin panel",
  "malware execution simulation via shell dropper",
  "lateral movement detected via SMB relay",
  "data exfiltration attempt over DNS tunnel",
  "c2 beaconing simulation via encrypted channel",
  "ransomware encryption simulation on /tmp/data — blocked",
  "credential dumping attempt via /proc/mem",
  "phishing payload delivery simulation",
];

export function runSelfRedTeam(prevHash: string): Array<{
  result: EventResult;
  fix: string | null;
}> {
  const results: Array<{ result: EventResult; fix: string | null }> = [];
  let currentPrevHash = prevHash;

  for (const attack of SELF_RED_TEAM_ATTACKS) {
    const result = buildEventResult(attack, currentPrevHash, 90, 90);
    const fix = autoFix(attack);
    results.push({ result, fix });
    currentPrevHash = result.hash;
  }

  return results;
}
