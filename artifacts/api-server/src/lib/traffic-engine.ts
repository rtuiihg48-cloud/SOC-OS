export const TRAFFIC_ANALYSIS_VERSION = "traffic-v1";

export type TrafficAnalysisInput = {
  observationType: "FLOW" | "HEARTBEAT";
  protocol: string;
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL" | "UNKNOWN";
  bytesOut: number;
  bytesIn: number;
  packets: number;
  durationMs: number;
  dnsQueryName?: string;
  heartbeatStatus?: "HEALTHY" | "DEGRADED" | "OFFLINE";
  heartbeatLatencyMs?: number;
};

export type TrafficSignal =
  | "BEACONING_PATTERN"
  | "PORT_SCAN_PATTERN"
  | "DNS_TUNNELING_PATTERN"
  | "OUTBOUND_VOLUME_ANOMALY"
  | "GATEWAY_DEGRADED"
  | "GATEWAY_OFFLINE"
  | "HEARTBEAT_LATENCY";

export type TrafficAnalysis = {
  riskScore: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  signals: TrafficSignal[];
  recommendedAction: "ALLOW" | "WARN" | "ISOLATE";
  analysisVersion: typeof TRAFFIC_ANALYSIS_VERSION;
};

function severityFor(score: number): TrafficAnalysis["severity"] {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

export function analyzeTraffic(input: TrafficAnalysisInput): TrafficAnalysis {
  let score = 0;
  const signals: TrafficSignal[] = [];

  if (input.observationType === "HEARTBEAT") {
    if (input.heartbeatStatus === "OFFLINE") {
      score += 80;
      signals.push("GATEWAY_OFFLINE");
    } else if (input.heartbeatStatus === "DEGRADED") {
      score += 40;
      signals.push("GATEWAY_DEGRADED");
    }
    if ((input.heartbeatLatencyMs ?? 0) >= 2_000) {
      score += 25;
      signals.push("HEARTBEAT_LATENCY");
    } else if ((input.heartbeatLatencyMs ?? 0) >= 750) {
      score += 10;
      signals.push("HEARTBEAT_LATENCY");
    }
  } else {
    const dnsName = input.dnsQueryName?.toLowerCase() ?? "";
    const longestDnsLabel = Math.max(0, ...dnsName.split(".").map((label) => label.length));

    if (
      input.protocol === "DNS" &&
      (dnsName.length >= 70 || longestDnsLabel >= 45)
    ) {
      score += 60;
      signals.push("DNS_TUNNELING_PATTERN");
    }

    if (
      input.packets >= 100 &&
      input.durationMs <= 60_000 &&
      input.bytesOut <= input.packets * 160
    ) {
      score += 55;
      signals.push("PORT_SCAN_PATTERN");
    }

    if (
      input.direction === "OUTBOUND" &&
      input.packets >= 5 &&
      input.packets <= 60 &&
      input.durationMs >= 300_000 &&
      input.bytesOut <= 65_536
    ) {
      score += 45;
      signals.push("BEACONING_PATTERN");
    }

    if (
      input.direction === "OUTBOUND" &&
      input.bytesOut >= 50_000_000 &&
      input.bytesOut >= Math.max(1, input.bytesIn) * 5
    ) {
      score += 75;
      signals.push("OUTBOUND_VOLUME_ANOMALY");
    }
  }

  const riskScore = Math.min(100, score);
  return {
    riskScore,
    severity: severityFor(riskScore),
    signals,
    recommendedAction:
      riskScore >= 65 ? "ISOLATE" :
      riskScore >= 25 ? "WARN" :
      "ALLOW",
    analysisVersion: TRAFFIC_ANALYSIS_VERSION,
  };
}