// ─── Correlation Engine ───────────────────────────────────────────────────────
// Looks at a sliding window of recent events and detects multi-step attack chains.
// This is the SIEM-level feature that elevates SOC-OS from "alert tool" to
// "threat intelligence platform" — it connects dots across individual events.

export interface CorrelationResult {
  threatType: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: number;
  summary: string;
}

// ─── Correlation Patterns ─────────────────────────────────────────────────────
// Each pattern defines a set of required signals that must appear in the event
// window. If all signals are present, a correlation is raised.
interface CorrelationPattern {
  name: string;
  signals: string[];           // All must appear somewhere in the window
  severity: CorrelationResult["severity"];
  confidence: number;
  summary: string;
}

const CORRELATION_PATTERNS: CorrelationPattern[] = [
  {
    name: "CHAIN_ATTACK",
    signals: ["scan", "exploit"],
    severity: "HIGH",
    confidence: 0.9,
    summary: "Reconnaissance scan followed by exploitation attempt — classic two-stage attack chain",
  },
  {
    name: "CREDENTIAL_STUFFING",
    signals: ["bruteforce", "login"],
    severity: "MEDIUM",
    confidence: 0.75,
    summary: "Brute-force combined with login attempts indicates credential stuffing campaign",
  },
  {
    name: "APT_SEQUENCE",
    signals: ["scan", "exploit", "lateral"],
    severity: "CRITICAL",
    confidence: 0.95,
    summary: "Full APT kill-chain: recon → exploit → lateral movement — possible nation-state actor",
  },
  {
    name: "EXFIL_CHAIN",
    signals: ["malware", "exfil"],
    severity: "CRITICAL",
    confidence: 0.92,
    summary: "Malware execution followed by data exfiltration — active data breach in progress",
  },
  {
    name: "PRIVILEGE_ESCALATION_CHAIN",
    signals: ["inject", "privilege"],
    severity: "CRITICAL",
    confidence: 0.88,
    summary: "Injection attack combined with privilege escalation — system compromise likely",
  },
  {
    name: "RANSOMWARE_PRECURSOR",
    signals: ["lateral", "ransomware"],
    severity: "CRITICAL",
    confidence: 0.97,
    summary: "Lateral movement preceding ransomware — immediate containment required",
  },
  {
    name: "C2_COMMUNICATION",
    signals: ["malware", "c2"],
    severity: "HIGH",
    confidence: 0.85,
    summary: "Malware establishing C2 channel — active command-and-control communication",
  },
  {
    name: "CREDENTIAL_DUMP_CHAIN",
    signals: ["credential", "lateral"],
    severity: "HIGH",
    confidence: 0.82,
    summary: "Credential dumping followed by lateral movement — pass-the-hash or token replay",
  },
];

// ─── Correlate a window of recent events ─────────────────────────────────────
// Takes the last N event strings (already processed) and checks for patterns.
// Returns the highest-confidence match, or null if no pattern found.
export function correlate(
  recentEvents: string[],
): CorrelationResult | null {
  const joined = recentEvents.join(" ").toLowerCase();

  let bestMatch: CorrelationResult | null = null;
  let bestConfidence = 0;

  for (const pattern of CORRELATION_PATTERNS) {
    const allSignalsPresent = pattern.signals.every((signal) =>
      joined.includes(signal),
    );

    if (allSignalsPresent && pattern.confidence > bestConfidence) {
      bestConfidence = pattern.confidence;
      bestMatch = {
        threatType: pattern.name,
        severity: pattern.severity,
        confidence: pattern.confidence,
        summary: pattern.summary,
      };
    }
  }

  return bestMatch;
}

// ─── Severity rank for comparison ────────────────────────────────────────────
export function severityRank(s: string): number {
  const ranks: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return ranks[s.toUpperCase()] ?? 0;
}
