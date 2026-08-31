import { describe, expect, it } from "vitest";
import { analyzeTraffic } from "./traffic-engine";
import { IngestTrafficTelemetryBody } from "@workspace/api-zod";
import { gatewayScopeAllows, validateTelemetry } from "../routes/traffic";

const baseFlow = {
  observationType: "FLOW" as const,
  protocol: "TCP",
  direction: "OUTBOUND" as const,
  bytesOut: 1_000,
  bytesIn: 1_000,
  packets: 10,
  durationMs: 1_000,
};

describe("traffic analysis", () => {
  it("detects beaconing deterministically", () => {
    const input = { ...baseFlow, protocol: "TLS", bytesOut: 24_000, bytesIn: 8_000, packets: 24, durationMs: 900_000 };
    expect(analyzeTraffic(input)).toEqual(analyzeTraffic(input));
    expect(analyzeTraffic(input).signals).toContain("BEACONING_PATTERN");
  });

  it("detects port scans", () => {
    expect(analyzeTraffic({ ...baseFlow, packets: 400, bytesOut: 32_000, durationMs: 20_000 }).signals)
      .toContain("PORT_SCAN_PATTERN");
  });

  it("detects DNS tunneling", () => {
    expect(analyzeTraffic({
      ...baseFlow,
      protocol: "DNS",
      dnsQueryName: `${"a".repeat(52)}.${"b".repeat(28)}.invalid`,
    }).signals).toContain("DNS_TUNNELING_PATTERN");
  });

  it("detects anomalous outbound volume", () => {
    const result = analyzeTraffic({ ...baseFlow, protocol: "HTTPS", bytesOut: 120_000_000, bytesIn: 2_000_000 });
    expect(result.signals).toContain("OUTBOUND_VOLUME_ANOMALY");
    expect(result.recommendedAction).toBe("ISOLATE");
  });

  it("reports degraded and offline gateway health", () => {
    expect(analyzeTraffic({
      ...baseFlow,
      observationType: "HEARTBEAT",
      heartbeatStatus: "DEGRADED",
      heartbeatLatencyMs: 2_500,
    }).signals).toEqual(["GATEWAY_DEGRADED", "HEARTBEAT_LATENCY"]);
    expect(analyzeTraffic({
      ...baseFlow,
      observationType: "HEARTBEAT",
      heartbeatStatus: "OFFLINE",
    }).signals).toContain("GATEWAY_OFFLINE");
  });

  it("accepts bounded protocol metadata and rejects oversized fields", () => {
    expect(IngestTrafficTelemetryBody.parse({
      gatewayId: "gateway-1",
      observationId: "obs-1",
      observationType: "FLOW",
      observedAt: new Date(),
      protocol: "TLS",
      sourceAsset: "endpoint-1",
      destinationAsset: "service-1",
      tlsServerName: "service.example",
      httpHost: "service.example",
    })).toMatchObject({ protocol: "TLS", tlsServerName: "service.example", httpHost: "service.example" });
    expect(IngestTrafficTelemetryBody.safeParse({
      gatewayId: "g".repeat(121),
      observationId: "obs-2",
      observedAt: new Date(),
    }).success).toBe(false);
  });

  it("rejects incomplete, stale, and future telemetry", () => {
    const parse = (overrides: Record<string, unknown>) => IngestTrafficTelemetryBody.parse({
      gatewayId: "gateway-1",
      observationId: "obs-1",
      observationType: "FLOW",
      observedAt: new Date(),
      protocol: "TCP",
      sourceAsset: "endpoint-1",
      destinationAsset: "service-1",
      ...overrides,
    });
    expect(validateTelemetry(parse({ sourceAsset: undefined }))).toContain("require");
    expect(validateTelemetry(parse({ observedAt: new Date(Date.now() + 6 * 60_000) }))).toContain("future");
    expect(validateTelemetry(parse({ observedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) }))).toContain("30-day");
    expect(validateTelemetry(parse({ observationType: "HEARTBEAT", heartbeatStatus: undefined }))).toContain("heartbeatStatus");
  });

  it("enforces gateway credential provenance without limiting service principals", () => {
    const basePrincipal = {
      principalId: "credential",
      tenantIds: [1],
      roles: [],
      capabilities: ["events:ingest" as const],
      authMethod: "SCOPED_CREDENTIAL" as const,
      credentialVersion: 1,
      correlationId: "test",
    };
    expect(gatewayScopeAllows({ ...basePrincipal, principalType: "GATEWAY", gatewayScope: "gateway-1" }, "gateway-1")).toBe(true);
    expect(gatewayScopeAllows({ ...basePrincipal, principalType: "GATEWAY", gatewayScope: "gateway-1" }, "gateway-2")).toBe(false);
    expect(gatewayScopeAllows({ ...basePrincipal, principalType: "GATEWAY", gatewayScope: null }, "gateway-1")).toBe(false);
    expect(gatewayScopeAllows({ ...basePrincipal, principalType: "SERVICE" }, "gateway-2")).toBe(true);
  });
});