import { createPublicKey } from "node:crypto";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import {
  db,
  nodeExchangeBlocksTable,
  nodeExchangeHeadsTable,
  nodeExchangeNodesTable,
  nodeExchangeRouteHopsTable,
} from "@workspace/db";
import type { Principal } from "./control-policy";
import { appendAudit } from "./audit";
import {
  GENESIS_HASH,
  NODE_EXCHANGE_PROTOCOL,
  NODE_EXCHANGE_SIGNATURE_ALGORITHM,
  canonicalEnvelope,
  constantTimeHashEqual,
  hashExchangeBlock,
  hashExchangeEnvelope,
  hashExchangeHop,
  hashExchangePayload,
  validateExchangeEnvelope,
  verifyEnvelopeSignature,
  type NodeExchangeEnvelope,
} from "./node-exchange-crypto";

export class NodeExchangeError extends Error {
  constructor(
    public readonly reasonCode: string,
    public readonly statusCode: number,
  ) {
    super(reasonCode);
  }
}

export interface RegisterNodeInput {
  tenantId: number;
  nodeId: string;
  role: string;
  publicKey: string;
  keyVersion: number;
  allowedPeerIds: string[];
  principal: Principal;
}

const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const NODE_ROLE = /^[A-Z][A-Z0-9_]{0,63}$/;

function scopeForTenant(tenantId: number): string {
  return `tenant:${tenantId}`;
}

function assertEd25519PublicKey(publicKey: string): void {
  try {
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
  } catch {
    throw new NodeExchangeError("INVALID_ED25519_PUBLIC_KEY", 400);
  }
}

export async function registerExchangeNode(input: RegisterNodeInput) {
  if (!NODE_ID.test(input.nodeId)) throw new NodeExchangeError("INVALID_NODE_ID", 400);
  if (!NODE_ROLE.test(input.role)) throw new NodeExchangeError("INVALID_NODE_ROLE", 400);
  if (!Number.isSafeInteger(input.keyVersion) || input.keyVersion <= 0) {
    throw new NodeExchangeError("INVALID_KEY_VERSION", 400);
  }
  if (
    input.allowedPeerIds.length > 64 ||
    new Set(input.allowedPeerIds).size !== input.allowedPeerIds.length ||
    input.allowedPeerIds.some((peer) => !NODE_ID.test(peer))
  ) {
    throw new NodeExchangeError("INVALID_ALLOWED_PEERS", 400);
  }
  assertEd25519PublicKey(input.publicKey);
  return db.transaction(async (tx) => {
    const nodeScope = `${input.tenantId}:${input.nodeId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${nodeScope}))`);
    const now = new Date();
    await tx
      .update(nodeExchangeNodesTable)
      .set({ status: "SUSPENDED", rotatedAt: now })
      .where(and(
        eq(nodeExchangeNodesTable.tenantId, input.tenantId),
        eq(nodeExchangeNodesTable.nodeId, input.nodeId),
        eq(nodeExchangeNodesTable.status, "ACTIVE"),
      ));
    const [created] = await tx
      .insert(nodeExchangeNodesTable)
      .values({
        tenantId: input.tenantId,
        nodeId: input.nodeId,
        role: input.role,
        publicKey: input.publicKey,
        keyVersion: input.keyVersion,
        allowedPeerIds: input.allowedPeerIds,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new NodeExchangeError("NODE_KEY_VERSION_ALREADY_EXISTS", 409);
    await appendAudit(tx, {
      tenantId: input.tenantId,
      principal: input.principal,
      action: "node-exchange:register",
      targetType: "node_exchange_node",
      targetId: `${input.nodeId}:v${input.keyVersion}`,
      decision: "COMMITTED",
      reasonCode: "NODE_KEY_REGISTERED",
      correlationId: input.principal.correlationId,
      metadata: {
        nodeId: input.nodeId,
        role: input.role,
        keyVersion: input.keyVersion,
        allowedPeerIds: input.allowedPeerIds,
      },
    });
    return {
      nodeId: created.nodeId,
      role: created.role,
      keyVersion: created.keyVersion,
      status: created.status,
      allowedPeerIds: created.allowedPeerIds,
      createdAt: created.createdAt.toISOString(),
    };
  });
}

export async function updateExchangeNodeStatus(input: {
  tenantId: number;
  nodeId: string;
  keyVersion: number;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  principal: Principal;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const nodeScope = `${input.tenantId}:${input.nodeId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${nodeScope}))`);
    const [current] = await tx
      .select()
      .from(nodeExchangeNodesTable)
      .where(and(
        eq(nodeExchangeNodesTable.tenantId, input.tenantId),
        eq(nodeExchangeNodesTable.nodeId, input.nodeId),
        eq(nodeExchangeNodesTable.keyVersion, input.keyVersion),
      ))
      .for("update")
      .limit(1);
    if (!current) throw new NodeExchangeError("NODE_KEY_NOT_FOUND", 404);
    if (current.status === "REVOKED" && input.status !== "REVOKED") {
      throw new NodeExchangeError("REVOKED_KEY_STATUS_IS_FINAL", 409);
    }
    if (input.status === "ACTIVE") {
      await tx
        .update(nodeExchangeNodesTable)
        .set({ status: "SUSPENDED", rotatedAt: now })
        .where(and(
          eq(nodeExchangeNodesTable.tenantId, input.tenantId),
          eq(nodeExchangeNodesTable.nodeId, input.nodeId),
          eq(nodeExchangeNodesTable.status, "ACTIVE"),
          sql`${nodeExchangeNodesTable.keyVersion} <> ${input.keyVersion}`,
        ));
    }
    const [updated] = await tx
      .update(nodeExchangeNodesTable)
      .set({
        status: input.status,
        revokedAt: input.status === "REVOKED" ? now : null,
      })
      .where(and(
        eq(nodeExchangeNodesTable.tenantId, input.tenantId),
        eq(nodeExchangeNodesTable.nodeId, input.nodeId),
        eq(nodeExchangeNodesTable.keyVersion, input.keyVersion),
      ))
      .returning();
    await appendAudit(tx, {
      tenantId: input.tenantId,
      principal: input.principal,
      action: "node-exchange:key-status",
      targetType: "node_exchange_node",
      targetId: `${input.nodeId}:v${input.keyVersion}`,
      decision: "COMMITTED",
      reasonCode: `NODE_KEY_${input.status}`,
      correlationId: input.principal.correlationId,
      metadata: { nodeId: input.nodeId, keyVersion: input.keyVersion, status: input.status },
    });
    return {
      nodeId: updated.nodeId,
      keyVersion: updated.keyVersion,
      status: updated.status,
      revokedAt: updated.revokedAt?.toISOString() ?? null,
    };
  });
}

export async function appendExchangeEnvelope(input: {
  tenantId: number;
  principal: Principal;
  gatewayNodeId: string;
  envelopeValue: unknown;
  now?: Date;
}) {
  if (input.principal.principalType !== "SERVICE" && input.principal.principalType !== "GATEWAY") {
    throw new NodeExchangeError("SERVICE_OR_GATEWAY_PRINCIPAL_REQUIRED", 403);
  }
  const now = input.now ?? new Date();
  const validation = validateExchangeEnvelope(input.envelopeValue, now);
  if (!validation.ok) throw new NodeExchangeError(validation.reasonCode, 400);
  const envelope = validation.envelope;
  const scopeKey = scopeForTenant(input.tenantId);
  const envelopeHash = hashExchangeEnvelope(envelope);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`);

    const [existing] = await tx
      .select()
      .from(nodeExchangeBlocksTable)
      .where(and(
        eq(nodeExchangeBlocksTable.scopeKey, scopeKey),
        eq(nodeExchangeBlocksTable.messageId, envelope.messageId),
        eq(nodeExchangeBlocksTable.hopSequence, envelope.hopSequence),
      ))
      .limit(1);
    if (existing) {
      if (!constantTimeHashEqual(existing.envelopeHash, envelopeHash)) {
        throw new NodeExchangeError("MESSAGE_HOP_CONFLICT", 409);
      }
      const [existingHop] = await tx
        .select()
        .from(nodeExchangeRouteHopsTable)
        .where(eq(nodeExchangeRouteHopsTable.blockId, existing.id))
        .limit(1);
      return serializeAccepted(existing, existingHop!, true);
    }

    const [sender] = await tx
      .select()
      .from(nodeExchangeNodesTable)
      .where(and(
        eq(nodeExchangeNodesTable.tenantId, input.tenantId),
        eq(nodeExchangeNodesTable.nodeId, envelope.senderNodeId),
        eq(nodeExchangeNodesTable.keyVersion, envelope.keyVersion),
      ))
      .for("update")
      .limit(1);
    if (!sender) throw new NodeExchangeError("NODE_KEY_NOT_FOUND", 404);
    if (sender.status !== "ACTIVE") throw new NodeExchangeError("NODE_KEY_NOT_ACTIVE", 403);
    if (envelope.sequence <= sender.lastSenderSequence) {
      throw new NodeExchangeError("STALE_SENDER_SEQUENCE", 409);
    }
    if (!sender.allowedPeerIds.includes(envelope.recipientNodeId)) {
      throw new NodeExchangeError("ROUTE_NOT_ALLOWED", 403);
    }
    if (!verifyEnvelopeSignature(envelope, sender.publicKey)) {
      throw new NodeExchangeError("SIGNATURE_INVALID", 400);
    }

    if (envelope.hopSequence === 0) {
      if (envelope.previousMessageHash !== GENESIS_HASH) {
        throw new NodeExchangeError("INVALID_ROUTE_GENESIS", 409);
      }
    } else {
      const [predecessor] = await tx
        .select({
          hopHash: nodeExchangeRouteHopsTable.hopHash,
          destinationNodeId: nodeExchangeRouteHopsTable.destinationNodeId,
        })
        .from(nodeExchangeRouteHopsTable)
        .where(and(
          eq(nodeExchangeRouteHopsTable.tenantId, input.tenantId),
          eq(nodeExchangeRouteHopsTable.messageId, envelope.messageId),
          eq(nodeExchangeRouteHopsTable.hopSequence, envelope.hopSequence - 1),
        ))
        .limit(1);
      if (!predecessor) throw new NodeExchangeError("ROUTE_PREDECESSOR_MISSING", 409);
      if (
        predecessor.destinationNodeId !== envelope.senderNodeId ||
        !constantTimeHashEqual(predecessor.hopHash, envelope.previousMessageHash)
      ) {
        throw new NodeExchangeError("ROUTE_PREDECESSOR_MISMATCH", 409);
      }
    }

    await tx
      .insert(nodeExchangeHeadsTable)
      .values({ scopeKey, tenantId: input.tenantId })
      .onConflictDoNothing();
    const locked = await tx.execute(
      sql`SELECT sequence, current_hash FROM node_exchange_heads WHERE scope_key = ${scopeKey} FOR UPDATE`,
    );
    const head = locked.rows[0] as { sequence: number; current_hash: string } | undefined;
    if (!head) throw new NodeExchangeError("LEDGER_HEAD_UNAVAILABLE", 503);
    const blockSequence = Number(head.sequence) + 1;
    const acceptedAt = now.toISOString();
    const previousBlockHash = head.current_hash;
    const blockHash = hashExchangeBlock({
      scopeKey,
      blockSequence,
      tenantId: input.tenantId,
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      hopSequence: envelope.hopSequence,
      senderNodeId: envelope.senderNodeId,
      recipientNodeId: envelope.recipientNodeId,
      gatewayNodeId: input.gatewayNodeId,
      envelopeHash,
      payloadHash: envelope.payloadHash,
      previousBlockHash,
      acceptedAt,
    });
    const [block] = await tx
      .insert(nodeExchangeBlocksTable)
      .values({
        scopeKey,
        tenantId: input.tenantId,
        blockSequence,
        messageId: envelope.messageId,
        correlationId: envelope.correlationId,
        hopSequence: envelope.hopSequence,
        senderNodeId: envelope.senderNodeId,
        recipientNodeId: envelope.recipientNodeId,
        gatewayNodeId: input.gatewayNodeId,
        protocolVersion: envelope.protocolVersion,
        payloadType: envelope.payloadType,
        payload: envelope.payload,
        envelopeHash,
        payloadHash: envelope.payloadHash,
        previousBlockHash,
        previousMessageHash: envelope.previousMessageHash,
        blockHash,
        nonce: envelope.nonce,
        senderSequence: envelope.sequence,
        issuedAt: new Date(envelope.issuedAt),
        expiresAt: new Date(envelope.expiresAt),
        signature: envelope.signature,
        signatureAlgorithm: envelope.signatureAlgorithm,
        keyVersion: envelope.keyVersion,
        verificationStatus: "VERIFIED",
        acceptedAt: now,
      })
      .returning();
    if (!block) throw new NodeExchangeError("LEDGER_APPEND_FAILED", 500);
    await tx
      .update(nodeExchangeNodesTable)
      .set({ lastSenderSequence: envelope.sequence })
      .where(eq(nodeExchangeNodesTable.id, sender.id));

    const hopHash = hashExchangeHop({
      tenantId: input.tenantId,
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      hopSequence: envelope.hopSequence,
      sourceNodeId: envelope.senderNodeId,
      gatewayNodeId: input.gatewayNodeId,
      destinationNodeId: envelope.recipientNodeId,
      blockHash,
      previousMessageHash: envelope.previousMessageHash,
      receivedAt: acceptedAt,
    });
    const [hop] = await tx
      .insert(nodeExchangeRouteHopsTable)
      .values({
        tenantId: input.tenantId,
        messageId: envelope.messageId,
        correlationId: envelope.correlationId,
        hopSequence: envelope.hopSequence,
        sourceNodeId: envelope.senderNodeId,
        gatewayNodeId: input.gatewayNodeId,
        destinationNodeId: envelope.recipientNodeId,
        blockId: block.id,
        receivedAt: now,
        forwardedAt: now,
        hopHash,
        payloadHashVerified: true,
        signatureVerified: true,
        previousBlockVerified: true,
        routePolicyVerified: true,
        routeDecision: "ACCEPTED",
        reasonCode: "INTEGRITY_VERIFIED",
      })
      .returning();
    if (!hop) throw new NodeExchangeError("ROUTE_APPEND_FAILED", 500);
    await tx
      .update(nodeExchangeHeadsTable)
      .set({ sequence: blockSequence, currentHash: blockHash, updatedAt: now })
      .where(eq(nodeExchangeHeadsTable.scopeKey, scopeKey));
    await appendAudit(tx, {
      tenantId: input.tenantId,
      principal: input.principal,
      action: "node-exchange:accept",
      targetType: "node_exchange_message",
      targetId: envelope.messageId,
      decision: "ACCEPTED",
      reasonCode: "INTEGRITY_VERIFIED",
      correlationId: envelope.correlationId,
      metadata: {
        messageId: envelope.messageId,
        hopSequence: envelope.hopSequence,
        senderNodeId: envelope.senderNodeId,
        recipientNodeId: envelope.recipientNodeId,
        blockSequence,
        blockHash,
        payloadHash: envelope.payloadHash,
        keyVersion: envelope.keyVersion,
      },
    });
    return serializeAccepted(block, hop, false);
  }).catch((error) => {
    if (error instanceof NodeExchangeError) throw error;
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new NodeExchangeError("REPLAY_OR_SEQUENCE_CONFLICT", 409);
    throw error;
  });
}

function serializeAccepted(block: typeof nodeExchangeBlocksTable.$inferSelect, hop: typeof nodeExchangeRouteHopsTable.$inferSelect, idempotent: boolean) {
  return {
    messageId: block.messageId,
    correlationId: block.correlationId,
    idempotent,
    verificationStatus: "VERIFIED" as const,
    block: serializeBlock(block),
    hop: serializeHop(hop),
    policy: "Integrity verification only; payload execution and production mutation are disabled.",
  };
}

function serializeBlock(block: typeof nodeExchangeBlocksTable.$inferSelect) {
  return {
    id: block.id,
    sequence: block.blockSequence,
    messageId: block.messageId,
    correlationId: block.correlationId,
    hopSequence: block.hopSequence,
    senderNodeId: block.senderNodeId,
    recipientNodeId: block.recipientNodeId,
    gatewayNodeId: block.gatewayNodeId,
    payloadType: block.payloadType,
    payloadHash: block.payloadHash,
    envelopeHash: block.envelopeHash,
    previousBlockHash: block.previousBlockHash,
    blockHash: block.blockHash,
    previousMessageHash: block.previousMessageHash,
    keyVersion: block.keyVersion,
    verificationStatus: block.verificationStatus,
    acceptedAt: block.acceptedAt.toISOString(),
  };
}

function serializeHop(hop: typeof nodeExchangeRouteHopsTable.$inferSelect) {
  return {
    sequence: hop.hopSequence,
    sourceNodeId: hop.sourceNodeId,
    gatewayNodeId: hop.gatewayNodeId,
    destinationNodeId: hop.destinationNodeId,
    hopHash: hop.hopHash,
    blockId: hop.blockId,
    decision: hop.routeDecision,
    reasonCode: hop.reasonCode,
    checks: {
      payloadHash: hop.payloadHashVerified,
      signature: hop.signatureVerified,
      previousBlock: hop.previousBlockVerified,
      routePolicy: hop.routePolicyVerified,
    },
    receivedAt: hop.receivedAt.toISOString(),
    forwardedAt: hop.forwardedAt?.toISOString() ?? null,
  };
}

export async function getExchangeRoute(tenantId: number, messageId: string) {
  const blocks = await db
    .select()
    .from(nodeExchangeBlocksTable)
    .where(and(
      eq(nodeExchangeBlocksTable.tenantId, tenantId),
      eq(nodeExchangeBlocksTable.messageId, messageId),
    ))
    .orderBy(asc(nodeExchangeBlocksTable.hopSequence));
  if (blocks.length === 0) throw new NodeExchangeError("MESSAGE_NOT_FOUND", 404);
  const hops = await db
    .select()
    .from(nodeExchangeRouteHopsTable)
    .where(and(
      eq(nodeExchangeRouteHopsTable.tenantId, tenantId),
      eq(nodeExchangeRouteHopsTable.messageId, messageId),
    ))
    .orderBy(asc(nodeExchangeRouteHopsTable.hopSequence));

  const verifiedHops = [];
  let previousHopHash = GENESIS_HASH;
  for (const [index, block] of blocks.entries()) {
    const hop = hops[index];
    if (!hop || hop.blockId !== block.id) {
      verifiedHops.push({
        sequence: block.hopSequence,
        sourceNodeId: block.senderNodeId,
        gatewayNodeId: block.gatewayNodeId,
        destinationNodeId: block.recipientNodeId,
        hopHash: "MISSING",
        blockId: block.id,
        decision: "REJECTED",
        reasonCode: "ROUTE_HOP_MISSING",
        checks: {
          payloadHash: false,
          envelopeHash: false,
          signature: false,
          previousBlock: false,
          blockHash: false,
          hopHash: false,
          routeChain: false,
          routePolicy: false,
        },
        receivedAt: block.acceptedAt.toISOString(),
        forwardedAt: null,
        block: serializeBlock(block),
        integrityVerified: false,
        errorCode: "ROUTE_HOP_MISSING",
      });
      previousHopHash = "";
      continue;
    }
    const [nodeKey] = await db
      .select()
      .from(nodeExchangeNodesTable)
      .where(and(
        eq(nodeExchangeNodesTable.tenantId, tenantId),
        eq(nodeExchangeNodesTable.nodeId, block.senderNodeId),
        eq(nodeExchangeNodesTable.keyVersion, block.keyVersion),
      ))
      .limit(1);
    const envelope: NodeExchangeEnvelope = {
      protocolVersion: NODE_EXCHANGE_PROTOCOL,
      messageId: block.messageId,
      correlationId: block.correlationId,
      senderNodeId: block.senderNodeId,
      recipientNodeId: block.recipientNodeId,
      sequence: block.senderSequence,
      hopSequence: block.hopSequence,
      nonce: block.nonce,
      issuedAt: block.issuedAt.toISOString(),
      expiresAt: block.expiresAt.toISOString(),
      payloadType: block.payloadType,
      payload: block.payload,
      payloadHash: block.payloadHash,
      previousMessageHash: block.previousMessageHash,
      keyVersion: block.keyVersion,
      signatureAlgorithm: NODE_EXCHANGE_SIGNATURE_ALGORITHM,
      signature: block.signature,
    };
    const [predecessor] = block.blockSequence > 1
      ? await db
          .select({ blockHash: nodeExchangeBlocksTable.blockHash })
          .from(nodeExchangeBlocksTable)
          .where(and(
            eq(nodeExchangeBlocksTable.scopeKey, block.scopeKey),
            eq(nodeExchangeBlocksTable.blockSequence, block.blockSequence - 1),
          ))
          .limit(1)
      : [];
    const expectedPreviousBlockHash = predecessor?.blockHash ?? GENESIS_HASH;
    const payloadHashValid = constantTimeHashEqual(hashExchangePayload(block.payload), block.payloadHash);
    const envelopeHashValid = constantTimeHashEqual(hashExchangeEnvelope(envelope), block.envelopeHash);
    const signatureValid = Boolean(nodeKey && verifyEnvelopeSignature(envelope, nodeKey.publicKey));
    const previousBlockValid = constantTimeHashEqual(expectedPreviousBlockHash, block.previousBlockHash);
    const expectedBlockHash = hashExchangeBlock({
      scopeKey: block.scopeKey,
      blockSequence: block.blockSequence,
      tenantId: block.tenantId,
      messageId: block.messageId,
      correlationId: block.correlationId,
      hopSequence: block.hopSequence,
      senderNodeId: block.senderNodeId,
      recipientNodeId: block.recipientNodeId,
      gatewayNodeId: block.gatewayNodeId,
      envelopeHash: block.envelopeHash,
      payloadHash: block.payloadHash,
      previousBlockHash: block.previousBlockHash,
      acceptedAt: block.acceptedAt.toISOString(),
    });
    const blockHashValid = constantTimeHashEqual(expectedBlockHash, block.blockHash);
    const expectedHopHash = hashExchangeHop({
      tenantId,
      messageId: block.messageId,
      correlationId: block.correlationId,
      hopSequence: block.hopSequence,
      sourceNodeId: block.senderNodeId,
      gatewayNodeId: block.gatewayNodeId,
      destinationNodeId: block.recipientNodeId,
      blockHash: block.blockHash,
      previousMessageHash: block.previousMessageHash,
      receivedAt: hop.receivedAt.toISOString(),
    });
    const hopHashValid = constantTimeHashEqual(expectedHopHash, hop.hopHash);
    const routeChainValid =
      block.hopSequence === 0
        ? block.previousMessageHash === GENESIS_HASH
        : constantTimeHashEqual(block.previousMessageHash, previousHopHash);
    const integrityVerified =
      payloadHashValid && envelopeHashValid && signatureValid && previousBlockValid &&
      blockHashValid && hopHashValid && routeChainValid;
    verifiedHops.push({
      ...serializeHop(hop),
      block: serializeBlock(block),
      integrityVerified,
      checks: {
        payloadHash: payloadHashValid,
        envelopeHash: envelopeHashValid,
        signature: signatureValid,
        previousBlock: previousBlockValid,
        blockHash: blockHashValid,
        hopHash: hopHashValid,
        routeChain: routeChainValid,
        routePolicy: hop.routePolicyVerified,
      },
      errorCode: integrityVerified ? null : "INTEGRITY_CHECK_FAILED",
    });
    previousHopHash = hop.hopHash;
  }
  return {
    messageId,
    correlationId: blocks[0]!.correlationId,
    integrityVerified: verifiedHops.every((hop) => hop.integrityVerified),
    route: verifiedHops,
    policy: "Tamper-evident verification; successful ledger acceptance does not prove downstream execution.",
  };
}

export async function listExchangeMessages(tenantId: number) {
  const blocks = await db
    .select()
    .from(nodeExchangeBlocksTable)
    .where(eq(nodeExchangeBlocksTable.tenantId, tenantId))
    .orderBy(desc(nodeExchangeBlocksTable.acceptedAt))
    .limit(100);
  const messages = new Map<string, {
    messageId: string;
    correlationId: string;
    sourceNodeId: string;
    destinationNodeId: string;
    hopCount: number;
    lastAcceptedAt: string;
    recordedStatus: "RECORDED";
  }>();
  for (const block of blocks) {
    const current = messages.get(block.messageId);
    if (!current) {
      messages.set(block.messageId, {
        messageId: block.messageId,
        correlationId: block.correlationId,
        sourceNodeId: block.senderNodeId,
        destinationNodeId: block.recipientNodeId,
        hopCount: 1,
        lastAcceptedAt: block.acceptedAt.toISOString(),
        recordedStatus: "RECORDED",
      });
    } else {
      current.hopCount += 1;
      current.sourceNodeId = block.senderNodeId;
    }
    if (messages.size >= 20 && !current) break;
  }
  return [...messages.values()].slice(0, 20);
}

export async function getExchangeHealth(tenantId: number) {
  const scopeKey = scopeForTenant(tenantId);
  const [head] = await db
    .select()
    .from(nodeExchangeHeadsTable)
    .where(eq(nodeExchangeHeadsTable.scopeKey, scopeKey))
    .limit(1);
  const [latest] = await db
    .select()
    .from(nodeExchangeBlocksTable)
    .where(eq(nodeExchangeBlocksTable.scopeKey, scopeKey))
    .orderBy(desc(nodeExchangeBlocksTable.blockSequence))
    .limit(1);
  const [nodeCount] = await db
    .select({ count: count() })
    .from(nodeExchangeNodesTable)
    .where(and(
      eq(nodeExchangeNodesTable.tenantId, tenantId),
      eq(nodeExchangeNodesTable.status, "ACTIVE"),
    ));
  const headVerified = !head
    ? !latest
    : Boolean(latest && head.sequence === latest.blockSequence && head.currentHash === latest.blockHash);
  return {
    status: headVerified ? "HEALTHY" as const : "VERIFICATION_FAILED" as const,
    scopeKey,
    headSequence: head?.sequence ?? 0,
    headHash: head?.currentHash ?? GENESIS_HASH,
    activeNodeKeys: Number(nodeCount?.count ?? 0),
    lastAcceptedAt: latest?.acceptedAt.toISOString() ?? null,
    headConsistent: headVerified,
    protocolVersion: NODE_EXCHANGE_PROTOCOL,
    hashAlgorithm: "SHA-256" as const,
    signatureAlgorithm: NODE_EXCHANGE_SIGNATURE_ALGORITHM,
    transportPolicy: "TLS proxy plus scoped service credential. Direct-channel mTLS is an infrastructure requirement, not verified by this API.",
  };
}