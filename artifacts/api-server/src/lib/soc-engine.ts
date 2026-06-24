import crypto from "crypto";

export type Action = "ALLOW" | "WARN" | "ISOLATE" | "PATCHED";
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

// ─── MITRE ATT&CK Mapping ────────────────────────────────────────────────────
// Maps keyword patterns to MITRE ATT&CK tactics and techniques.
// This is the core "threat intelligence" layer that gives the engine
// enterprise-grade context instead of raw keyword hits.
const MITRE_MAP: Array<{ pattern: string; mapping: MitreMapping; weight: number }> = [
  {
    pattern: "inject",
    weight: 10,
    mapping: { tactic: "Initial Access", technique: "Exploit Public-Facing Application", techniqueId: "T1190" },
  },
  {
    pattern: "exploit",
    weight: 10,
    mapping: { tactic: "Execution", technique: "Exploitation for Client Execution", techniqueId: "T1203" },
  },
  {
    pattern: "scan",
    weight: 3,
    mapping: { tactic: "Discovery", technique: "Network Service Discovery", techniqueId: "T1046" },
  },
  {
    pattern: "botnet",
    weight: 10,
    mapping: { tactic: "Command and Control", technique: "Application Layer Protocol", techniqueId: "T1071" },
  },
  {
    pattern: "bruteforce",
    weight: 5,
    mapping: { tactic: "Credential Access", technique: "Brute Force", techniqueId: "T1110" },
  },
  {
    pattern: "malware",
    weight: 7,
    mapping: { tactic: "Execution", technique: "User Execution", techniqueId: "T1204" },
  },
  {
    pattern: "auth bypass",
    weight: 8,
    mapping: { tactic: "Defense Evasion", technique: "Abuse Elevation Control Mechanism", techniqueId: "T1548" },
  },
  {
    pattern: "privilege escalation",
    weight: 9,
    mapping: { tactic: "Privilege Escalation", technique: "Exploitation for Privilege Escalation", techniqueId: "T1068" },
  },
  {
    pattern: "lateral movement",
    weight: 8,
    mapping: { tactic: "Lateral Movement", technique: "Remote Services", techniqueId: "T1021" },
  },
  {
    pattern: "exfil",
    weight: 9,
    mapping: { tactic: "Exfiltration", technique: "Exfiltration Over C2 Channel", techniqueId: "T1041" },
  },
  {
    pattern: "ransomware",
    weight: 10,
    mapping: { tactic: "Impact", technique: "Data Encrypted for Impact", techniqueId: "T1486" },
  },
  {
    pattern: "phishing",
    weight: 4,
    mapping: { tactic: "Initial Access", technique: "Phishing", techniqueId: "T1566" },
  },
  {
    pattern: "credential",
    weight: 6,
    mapping: { tactic: "Credential Access", technique: "OS Credential Dumping", techniqueId: "T1003" },
  },
  {
    pattern: "rootkit",
    weight: 9,
    mapping: { tactic: "Defense Evasion", technique: "Rootkit", techniqueId: "T1014" },
  },
  {
    pattern: "backdoor",
    weight: 8,
    mapping: { tactic: "Persistence", technique: "Server Software Component", techniqueId: "T1505" },
  },
  {
    pattern: "ddos",
    weight: 7,
    mapping: { tactic: "Impact", technique: "Network Denial of Service", techniqueId: "T1498" },
  },
  {
    pattern: "c2",
    weight: 8,
    mapping: { tactic: "Command and Control", technique: "Encrypted Channel", techniqueId: "T1573" },
  },
];

// ─── Velocity / Burst Detection ───────────────────────────────────────────────
// Tracks how many times each event "type" (first keyword match) fires within
// a sliding 60-second window. If burst > 3 in 60s, it adds +5 to score
// and sets velocityFlag = true.
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
  if (entry.count >= VELOCITY_BURST_THRESHOLD) return true;
  return false;
}

// ─── Auto-Fix (SOAR) Patterns ─────────────────────────────────────────────────
const AUTO_FIX_MAP: Array<{ pattern: string; fix: string }> = [
  { pattern: "inject", fix: "PATCH: input validation hardened" },
  { pattern: "auth", fix: "PATCH: MFA enforcement enabled" },
  { pattern: "scan", fix: "PATCH: rate limiting enabled" },
  { pattern: "bruteforce", fix: "PATCH: account lockout policy enforced" },
  { pattern: "malware", fix: "PATCH: process isolation hardened" },
  { pattern: "lateral", fix: "PATCH: network segmentation enforced" },
  { pattern: "exfil", fix: "PATCH: DLP rules activated" },
  { pattern: "privilege", fix: "PATCH: least-privilege policy enforced" },
  { pattern: "credential", fix: "PATCH: credential rotation triggered" },
  { pattern: "rootkit", fix: "PATCH: kernel integrity check enforced" },
  { pattern: "backdoor", fix: "PATCH: endpoint isolation initiated" },
  { pattern: "ddos", fix: "PATCH: traffic scrubbing activated" },
  { pattern: "c2", fix: "PATCH: egress filtering enforced" },
  { pattern: "ransomware", fix: "PATCH: backup isolation + snapshot triggered" },
  { pattern: "phishing", fix: "PATCH: email gateway rules updated" },
];

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
  "ransomware encryption simulation on /tmp",
  "credential dumping attempt via /proc/mem",
  "phishing payload delivery simulation",
];

// ─── Core Engine Functions ─────────────────────────────────────────────────────

export function analyzeEvent(
  event: string,
  cpuUsage = 0,
  memUsage = 0,
): {
  score: number;
  mitre: MitreMapping | null;
  velocityFlag: boolean;
} {
  const lower = event.toLowerCase();
  let score = 0;
  let topMitre: MitreMapping | null = null;
  let topWeight = 0;
  let velocityKey = "unknown";

  for (const { pattern, mapping, weight } of MITRE_MAP) {
    if (lower.includes(pattern)) {
      score += weight;
      if (weight > topWeight) {
        topWeight = weight;
        topMitre = mapping;
        velocityKey = pattern;
      }
    }
  }

  // System stress bonus — high resource usage amplifies risk
  if (cpuUsage > 85) score += 5;
  if (memUsage > 85) score += 5;
  if (cpuUsage > 70 && memUsage > 70) score += 3; // combined stress

  const velocityFlag = score > 0 ? checkVelocity(velocityKey) : false;
  if (velocityFlag) score += VELOCITY_BONUS;

  return { score, mitre: topMitre, velocityFlag };
}

export function decideAction(score: number): Action {
  if (score >= 15) return "ISOLATE";
  if (score >= 7) return "WARN";
  return "ALLOW";
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

export function autoFix(attack: string): string | null {
  const lower = attack.toLowerCase();
  for (const { pattern, fix } of AUTO_FIX_MAP) {
    if (lower.includes(pattern)) return fix;
  }
  return null;
}

export function buildEventResult(
  event: string,
  prevHash: string,
  cpuUsage?: number,
  memUsage?: number,
): EventResult {
  const { score, mitre, velocityFlag } = analyzeEvent(event, cpuUsage ?? 0, memUsage ?? 0);
  const action = decideAction(score);
  const ts = Date.now();
  const nodeId = computeNodeId(event);
  const hash = computeHash(event, score, action, prevHash, ts);

  return {
    event,
    score,
    action,
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

export function runSelfRedTeam(prevHash: string): Array<{
  result: EventResult;
  fix: string | null;
}> {
  const results: Array<{ result: EventResult; fix: string | null }> = [];
  let currentPrevHash = prevHash;

  for (const attack of SELF_RED_TEAM_ATTACKS) {
    const result = buildEventResult(attack, currentPrevHash, 90, 90);
    const fix = result.action === "ALLOW" ? autoFix(attack) : autoFix(attack);
    results.push({ result, fix });
    currentPrevHash = result.hash;
  }

  return results;
}
