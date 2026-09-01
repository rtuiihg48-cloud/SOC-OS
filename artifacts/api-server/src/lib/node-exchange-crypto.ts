import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";

export const NODE_EXCHANGE_PROTOCOL = "node-exchange-v1" as const;
export const NODE_EXCHANGE_SIGNATURE_ALGORITHM = "Ed25519" as const;
export const NODE_EXCHANGE_MAX_PAYLOAD_BYTES = 16_384;
export const NODE_EXCHANGE_MAX_HOPS = 32;
export const NODE_EXCHANGE_MAX_TTL_MS = 5 * 60_000;
export const NODE_EXCHANGE_CLOCK_SKEW_MS = 60_000;
export const GENESIS_HASH = "GENESIS";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface NodeExchangeEnvelope {
  protocolVersion: typeof NODE_EXCHANGE_PROTOCOL;
  messageId: string;
  correlationId: string;
  senderNodeId: string;
  recipientNodeId: string;
  sequence: number;
  hopSequence: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  payloadType: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  previousMessageHash: string;
  keyVersion: number;
  signatureAlgorithm: typeof NODE_EXCHANGE_SIGNATURE_ALGORITHM;
  signature: string;
}

export interface ExchangeBlockHashInput {
  scopeKey: string;
  blockSequence: number;
  tenantId: number;
  messageId: string;
  correlationId: string;
  hopSequence: number;
  senderNodeId: string;
  recipientNodeId: string;
  gatewayNodeId: string;
  envelopeHash: string;
  payloadHash: string;
  previousBlockHash: string;
  acceptedAt: string;
}

export interface ExchangeHopHashInput {
  tenantId: number;
  messageId: string;
  correlationId: string;
  hopSequence: number;
  sourceNodeId: string;
  gatewayNodeId: string;
  destinationNodeId: string;
  blockHash: string;
  previousMessageHash: string;
  receivedAt: string;
}

function normalizeJson(value: unknown, path = "value", seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${path} contains a circular reference`);
    seen.add(value);
    const normalized = value.map((item, index) => normalizeJson(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return normalized;
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${path} is not JSON-compatible`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a circular reference`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain plain JSON objects`);
  }
  seen.add(value);
  const normalized: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    normalized[key] = normalizeJson(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return normalized;
}

export function canonicalExchangeJson(value: unknown): string {
  const normalized = normalizeJson(value);
  const serialize = (item: JsonValue): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(serialize).join(",")}]`;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${serialize(item[key]!)}`).join(",")}}`;
  };
  return serialize(normalized);
}

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashExchangePayload(payload: Record<string, unknown>): string {
  const canonical = canonicalExchangeJson(payload);
  if (Buffer.byteLength(canonical, "utf8") > NODE_EXCHANGE_MAX_PAYLOAD_BYTES) {
    throw new RangeError("PAYLOAD_TOO_LARGE");
  }
  return sha256(canonical);
}

export function unsignedEnvelope(envelope: NodeExchangeEnvelope): Omit<NodeExchangeEnvelope, "signature"> {
  const { signature: _signature, ...unsigned } = envelope;
  return unsigned;
}

export function canonicalEnvelope(envelope: NodeExchangeEnvelope): string {
  return canonicalExchangeJson(unsignedEnvelope(envelope));
}

export function hashExchangeEnvelope(envelope: NodeExchangeEnvelope): string {
  return sha256(canonicalEnvelope(envelope));
}

export function verifyEnvelopeSignature(envelope: NodeExchangeEnvelope, publicKeyPem: string): boolean {
  try {
    const signature = Buffer.from(envelope.signature, "base64url");
    if (signature.length !== 64) return false;
    const publicKey = createPublicKey(publicKeyPem);
    return verifySignature(null, Buffer.from(canonicalEnvelope(envelope), "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

export function constantTimeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashExchangeBlock(input: ExchangeBlockHashInput): string {
  return sha256(canonicalExchangeJson(input));
}

export function hashExchangeHop(input: ExchangeHopHashInput): string {
  return sha256(canonicalExchangeJson(input));
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const BASE64URL = /^[A-Za-z0-9_-]{16,256}$/;
const SHA256_HASH = /^sha256:[a-f0-9]{64}$/;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function validateExchangeEnvelope(
  value: unknown,
  now = new Date(),
): { ok: true; envelope: NodeExchangeEnvelope } | { ok: false; reasonCode: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reasonCode: "INVALID_ENVELOPE" };
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "protocolVersion", "messageId", "correlationId", "senderNodeId", "recipientNodeId",
    "sequence", "hopSequence", "nonce", "issuedAt", "expiresAt", "payloadType", "payload",
    "payloadHash", "previousMessageHash", "keyVersion", "signatureAlgorithm", "signature",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false, reasonCode: "UNKNOWN_ENVELOPE_FIELD" };
  }
  if (record.protocolVersion !== NODE_EXCHANGE_PROTOCOL) return { ok: false, reasonCode: "UNSUPPORTED_PROTOCOL" };
  if (record.signatureAlgorithm !== NODE_EXCHANGE_SIGNATURE_ALGORITHM) return { ok: false, reasonCode: "UNSUPPORTED_SIGNATURE_ALGORITHM" };
  for (const key of ["messageId", "correlationId", "senderNodeId", "recipientNodeId", "payloadType"] as const) {
    if (typeof record[key] !== "string" || !SAFE_IDENTIFIER.test(record[key])) {
      return { ok: false, reasonCode: `INVALID_${key.toUpperCase()}` };
    }
  }
  if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 0) {
    return { ok: false, reasonCode: "INVALID_SEQUENCE" };
  }
  if (!Number.isSafeInteger(record.hopSequence) || Number(record.hopSequence) < 0 || Number(record.hopSequence) >= NODE_EXCHANGE_MAX_HOPS) {
    return { ok: false, reasonCode: "INVALID_HOP_SEQUENCE" };
  }
  if (!Number.isSafeInteger(record.keyVersion) || Number(record.keyVersion) <= 0) {
    return { ok: false, reasonCode: "INVALID_KEY_VERSION" };
  }
  if (typeof record.nonce !== "string" || !BASE64URL.test(record.nonce)) {
    return { ok: false, reasonCode: "INVALID_NONCE" };
  }
  if (typeof record.signature !== "string" || !BASE64URL.test(record.signature)) {
    return { ok: false, reasonCode: "INVALID_SIGNATURE_ENCODING" };
  }
  if (typeof record.payloadHash !== "string" || !SHA256_HASH.test(record.payloadHash)) {
    return { ok: false, reasonCode: "INVALID_PAYLOAD_HASH" };
  }
  if (
    record.previousMessageHash !== GENESIS_HASH &&
    (typeof record.previousMessageHash !== "string" || !SHA256_HASH.test(record.previousMessageHash))
  ) {
    return { ok: false, reasonCode: "INVALID_PREVIOUS_MESSAGE_HASH" };
  }
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
    return { ok: false, reasonCode: "INVALID_PAYLOAD" };
  }
  if (
    typeof record.issuedAt !== "string" ||
    typeof record.expiresAt !== "string" ||
    !CANONICAL_UTC_TIMESTAMP.test(record.issuedAt) ||
    !CANONICAL_UTC_TIMESTAMP.test(record.expiresAt)
  ) {
    return { ok: false, reasonCode: "NON_CANONICAL_TIMESTAMP" };
  }
  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    new Date(issuedAt).toISOString() !== record.issuedAt ||
    new Date(expiresAt).toISOString() !== record.expiresAt
  ) {
    return { ok: false, reasonCode: "INVALID_TIMESTAMP" };
  }
  if (expiresAt <= issuedAt || expiresAt - issuedAt > NODE_EXCHANGE_MAX_TTL_MS) {
    return { ok: false, reasonCode: "INVALID_TTL" };
  }
  if (issuedAt > now.getTime() + NODE_EXCHANGE_CLOCK_SKEW_MS) {
    return { ok: false, reasonCode: "ISSUED_IN_FUTURE" };
  }
  if (expiresAt < now.getTime()) return { ok: false, reasonCode: "MESSAGE_EXPIRED" };
  try {
    const computedPayloadHash = hashExchangePayload(record.payload as Record<string, unknown>);
    if (!constantTimeHashEqual(computedPayloadHash, record.payloadHash)) {
      return { ok: false, reasonCode: "PAYLOAD_HASH_MISMATCH" };
    }
  } catch (error) {
    return {
      ok: false,
      reasonCode: error instanceof RangeError ? "PAYLOAD_TOO_LARGE" : "INVALID_PAYLOAD",
    };
  }
  return { ok: true, envelope: record as unknown as NodeExchangeEnvelope };
}