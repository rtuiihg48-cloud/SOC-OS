import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  GENESIS_HASH,
  NODE_EXCHANGE_PROTOCOL,
  NODE_EXCHANGE_SIGNATURE_ALGORITHM,
  canonicalEnvelope,
  canonicalExchangeJson,
  hashExchangeBlock,
  hashExchangePayload,
  sha256,
  validateExchangeEnvelope,
  verifyEnvelopeSignature,
  type NodeExchangeEnvelope,
} from "./node-exchange-crypto";

function signedEnvelope(payload: Record<string, unknown> = { risk: 72 }) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    protocolVersion: NODE_EXCHANGE_PROTOCOL,
    messageId: "msg_test",
    correlationId: "corr_test",
    senderNodeId: "N7",
    recipientNodeId: "N2",
    sequence: 1,
    hopSequence: 0,
    nonce: "abcdefghijklmnop",
    issuedAt: "2026-09-01T08:00:00.000Z",
    expiresAt: "2026-09-01T08:01:00.000Z",
    payloadType: "strategy.signal",
    payload,
    payloadHash: hashExchangePayload(payload),
    previousMessageHash: GENESIS_HASH,
    keyVersion: 1,
    signatureAlgorithm: NODE_EXCHANGE_SIGNATURE_ALGORITHM,
  };
  const signature = sign(null, Buffer.from(canonicalExchangeJson(unsigned)), privateKey).toString("base64url");
  return {
    envelope: { ...unsigned, signature } as NodeExchangeEnvelope,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("node exchange crypto", () => {
  it("canonicalizes nested JSON independently of key insertion order", () => {
    expect(canonicalExchangeJson({ b: 2, a: { y: 2, x: 1 } })).toBe(
      canonicalExchangeJson({ a: { x: 1, y: 2 }, b: 2 }),
    );
  });

  it("verifies an Ed25519 envelope and detects payload tampering", () => {
    const { envelope, publicKey } = signedEnvelope();
    expect(verifyEnvelopeSignature(envelope, publicKey)).toBe(true);
    expect(validateExchangeEnvelope(envelope, new Date("2026-09-01T08:00:10.000Z")).ok).toBe(true);

    const tampered = { ...envelope, payload: { risk: 1 } };
    expect(validateExchangeEnvelope(tampered, new Date("2026-09-01T08:00:10.000Z"))).toEqual({
      ok: false,
      reasonCode: "PAYLOAD_HASH_MISMATCH",
    });
    expect(verifyEnvelopeSignature(tampered, publicKey)).toBe(false);
  });

  it("links block hashes to their predecessor and route metadata", () => {
    const base = {
      scopeKey: "tenant:7",
      blockSequence: 1,
      tenantId: 7,
      messageId: "msg_test",
      correlationId: "corr_test",
      hopSequence: 0,
      senderNodeId: "N7",
      recipientNodeId: "N2",
      gatewayNodeId: "GW1",
      envelopeHash: sha256(canonicalEnvelope(signedEnvelope().envelope)),
      payloadHash: hashExchangePayload({ risk: 72 }),
      previousBlockHash: GENESIS_HASH,
      acceptedAt: "2026-09-01T08:00:10.000Z",
    };
    expect(hashExchangeBlock(base)).not.toBe(hashExchangeBlock({ ...base, previousBlockHash: sha256("changed") }));
  });

  it("rejects expired envelopes and unknown fields", () => {
    const { envelope } = signedEnvelope();
    expect(validateExchangeEnvelope(envelope, new Date("2026-09-01T08:02:00.000Z"))).toEqual({
      ok: false,
      reasonCode: "MESSAGE_EXPIRED",
    });
    expect(validateExchangeEnvelope({ ...envelope, unexpected: true }, new Date("2026-09-01T08:00:10.000Z"))).toEqual({
      ok: false,
      reasonCode: "UNKNOWN_ENVELOPE_FIELD",
    });
  });

  it("rejects alternate timestamp representations before signature acceptance", () => {
    const { envelope } = signedEnvelope();
    expect(validateExchangeEnvelope(
      { ...envelope, issuedAt: "2026-09-01T08:00:00Z" },
      new Date("2026-09-01T08:00:10.000Z"),
    )).toEqual({ ok: false, reasonCode: "NON_CANONICAL_TIMESTAMP" });
    expect(validateExchangeEnvelope(
      { ...envelope, issuedAt: "2026-02-30T08:00:00.000Z" },
      new Date("2026-02-01T08:00:10.000Z"),
    )).toEqual({ ok: false, reasonCode: "INVALID_TIMESTAMP" });
  });
});