import { createHash } from "crypto";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { auditChainHeadsTable, auditRecordsTable } from "@workspace/db";
import type { Principal } from "../control-policy";

export type AuditDecision = "ALLOWED" | "DENIED" | "COMMITTED" | "FAILED" | "REJECTED" | "ACCEPTED" | "QUEUED";
export type AuditInput = { tenantId: number | null; principal: Principal; action: string; targetType: string; targetId: string; decision: AuditDecision; reasonCode: string; correlationId: string; metadata?: Record<string, unknown>; occurredAt?: Date };
export const SYSTEM_PARTITION = "system";
export const partitionFor = (tenantId: number | null) => tenantId === null ? SYSTEM_PARTITION : `tenant:${tenantId}`;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * JSON.stringify accepts values which are not JSON (for example undefined in
 * objects and NaN). Audit evidence must not depend on those coercions. Normalize
 * the entire metadata tree before it is either hashed or handed to jsonb.
 */
function normalizeJson(value: unknown, path = "metadata", seen = new WeakSet<object>()): JsonValue {
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
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`${path} is not JSON-compatible`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a circular reference`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain JSON object`);
  }
  seen.add(value);
  const normalized: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    normalized[key] = normalizeJson(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return normalized;
}

/** Serialize a JSON value recursively with lexicographically sorted object keys. */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

export function sanitizeMetadata(value: Record<string, unknown> = {}): Record<string, unknown> {
  const redact = /secret|token|password|authorization|cookie|payload|instruction/i;
  const clean = (input: unknown, seen = new WeakSet<object>()): unknown => {
    if (typeof input === "string") return input.slice(0, 512);
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) throw new TypeError("metadata contains a circular reference");
    seen.add(input);
    if (Array.isArray(input)) {
      const output = input.map((item) => clean(item, seen));
      seen.delete(input);
      return output;
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("metadata must contain only plain JSON objects");
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      if (!redact.test(key)) output[key.slice(0, 80)] = clean(item, seen);
    }
    seen.delete(input);
    return output;
  };
  const normalized = normalizeJson(clean(value)) as Record<string, JsonValue>;
  if (Buffer.byteLength(canonicalJson(normalized)) > 4096) return { truncated: true };
  return normalized;
}
export function canonicalAuditPayload(record: Record<string, unknown>): string {
  const keys = ["partitionKey", "sequence", "tenantId", "occurredAt", "principalId", "principalType", "action", "targetType", "targetId", "decision", "reasonCode", "correlationId", "metadata", "prevHash"];
  // Keep the established top-level field order so simple historical evidence
  // keeps its digest, while making every nested JSON object canonical.
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(normalizeJson(record[key] ?? null, key))}`).join(",")}}`;
}
export const auditHash = (record: Record<string, unknown>) => createHash("sha256").update(canonicalAuditPayload(record)).digest("hex");
export async function appendAudit(tx: any, input: AuditInput) {
  const partitionKey = partitionFor(input.tenantId);
  await tx.execute(sql`INSERT INTO audit_chain_heads (partition_key, tenant_id, sequence, current_hash) VALUES (${partitionKey}, ${input.tenantId}, 0, 'GENESIS') ON CONFLICT (partition_key) DO NOTHING`);
  const locked = await tx.execute(sql`SELECT sequence, current_hash FROM audit_chain_heads WHERE partition_key = ${partitionKey} FOR UPDATE`);
  const head = locked.rows[0] as { sequence: number; current_hash: string };
  const occurredAt = input.occurredAt ?? new Date(); const metadata = sanitizeMetadata(input.metadata);
  const payload = { partitionKey, sequence: Number(head.sequence) + 1, tenantId: input.tenantId, occurredAt: occurredAt.toISOString(), principalId: input.principal.principalId, principalType: input.principal.principalType, action: input.action, targetType: input.targetType, targetId: input.targetId, decision: input.decision, reasonCode: input.reasonCode, correlationId: input.correlationId, metadata, prevHash: head.current_hash };
  const hash = auditHash(payload);
  const [record] = await tx.insert(auditRecordsTable).values({ ...payload, occurredAt, metadata, hash }).returning();
  await tx.update(auditChainHeadsTable).set({ sequence: payload.sequence, currentHash: hash, updatedAt: new Date() }).where(eq(auditChainHeadsTable.partitionKey, partitionKey));
  return record;
}
export async function verifyAudit(db: any, tenantId: number | null, from?: Date, to?: Date) {
  const partitionKey = partitionFor(tenantId);
  const predicates = [eq(auditRecordsTable.partitionKey, partitionFor(tenantId))];
  if (from) predicates.push(gte(auditRecordsTable.occurredAt, from)); if (to) predicates.push(lte(auditRecordsTable.occurredAt, to));
  const rows = await db.select().from(auditRecordsTable).where(and(...predicates)).orderBy(asc(auditRecordsTable.sequence));
  const completeChain = !from && !to;
  const [head] = await db.select().from(auditChainHeadsTable).where(eq(auditChainHeadsTable.partitionKey, partitionKey)).limit(1);
  if (rows.length === 0) {
    const valid = !completeChain || (!head || (head.sequence === 0 && head.currentHash === "GENESIS"));
    return { valid, checked: 0, firstBrokenSequence: null, errorCode: valid ? null : "HEAD_MISMATCH" };
  }
  const [predecessor] = await db.select().from(auditRecordsTable)
    .where(and(eq(auditRecordsTable.partitionKey, partitionFor(tenantId)), lt(auditRecordsTable.sequence, rows[0]!.sequence)))
    .orderBy(desc(auditRecordsTable.sequence)).limit(1);
  let previous = predecessor?.hash ?? "GENESIS";
  let expectedSequence = predecessor ? predecessor.sequence + 1 : 1;
  for (const row of rows) {
    const expected = auditHash({ ...row, occurredAt: row.occurredAt.toISOString() });
    if (row.sequence !== expectedSequence || row.prevHash !== previous || row.hash !== expected) {
      return { valid: false, checked: rows.length, firstBrokenSequence: row.sequence, errorCode: row.sequence !== expectedSequence ? "SEQUENCE_GAP" : row.prevHash !== previous ? "PREDECESSOR_MISMATCH" : "HASH_MISMATCH" };
    }
    previous = row.hash; expectedSequence += 1;
  }
  if (completeChain && (!head || head.sequence !== rows[rows.length - 1]!.sequence || head.currentHash !== previous)) {
    return { valid: false, checked: rows.length, firstBrokenSequence: rows[rows.length - 1]!.sequence, errorCode: "HEAD_MISMATCH" };
  }
  return { valid: true, checked: rows.length, firstBrokenSequence: null, errorCode: null };
}