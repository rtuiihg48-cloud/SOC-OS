import { createHash } from "node:crypto";
import {
  db,
  managedResourcesTable,
  selfHealingActionsTable,
  selfHealingRestorePointsTable,
} from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { appendAudit } from "./audit";
import type { Principal } from "./control-policy";

export const SELF_HEALING_POLICY = {
  maxStateBytes: 64 * 1024,
  executionAllowed: false as const,
  locationPrefix: "managed://" as const,
};

type JsonRecord = Record<string, unknown>;
type AuditContext = { principal: Principal; correlationId: string };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function hashManagedState(state: JsonRecord): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(state)))
    .digest("hex");
}

export function managedStateSize(state: JsonRecord): number {
  return Buffer.byteLength(JSON.stringify(state), "utf8");
}

function resourceScope(resourceKey: string, tenantId: number | null) {
  return and(
    eq(managedResourcesTable.resourceKey, resourceKey),
    tenantId === null
      ? isNull(managedResourcesTable.tenantId)
      : eq(managedResourcesTable.tenantId, tenantId),
  );
}

function restorePointScope(resourceKey: string, tenantId: number | null) {
  return and(
    eq(selfHealingRestorePointsTable.resourceKey, resourceKey),
    eq(selfHealingRestorePointsTable.status, "VERIFIED"),
    tenantId === null
      ? isNull(selfHealingRestorePointsTable.tenantId)
      : eq(selfHealingRestorePointsTable.tenantId, tenantId),
  );
}

export async function registerVerifiedManagedResource(input: {
  tenantId: number | null;
  resourceKey: string;
  location: string;
  state: JsonRecord;
  audit?: AuditContext;
}) {
  const stateHash = hashManagedState(input.state);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(managedResourcesTable)
      .where(resourceScope(input.resourceKey, input.tenantId))
      .limit(1);

    const [resource] = existing
      ? await tx
          .update(managedResourcesTable)
          .set({
            location: input.location,
            state: input.state,
            stateHash,
            integrityStatus: "VERIFIED",
            updatedAt: new Date(),
          })
          .where(eq(managedResourcesTable.id, existing.id))
          .returning()
      : await tx
          .insert(managedResourcesTable)
          .values({
            tenantId: input.tenantId,
            resourceKey: input.resourceKey,
            location: input.location,
            state: input.state,
            stateHash,
            integrityStatus: "VERIFIED",
          })
          .returning();

    const [restorePoint] = await tx
      .insert(selfHealingRestorePointsTable)
      .values({
        tenantId: input.tenantId,
        resourceKey: input.resourceKey,
        location: input.location,
        state: input.state,
        stateHash,
        status: "VERIFIED",
        source: existing ? "verified_update" : "initial_registration",
      })
      .returning();

    if (input.audit) await appendAudit(tx, {
      tenantId: input.tenantId, principal: input.audit.principal, action: "self_healing:resource:register",
      targetType: "managed_resource", targetId: String(resource.id), decision: "COMMITTED",
      reasonCode: existing ? "MANAGED_RESOURCE_UPDATED" : "MANAGED_RESOURCE_REGISTERED",
      correlationId: input.audit.correlationId, metadata: { resourceKey: resource.resourceKey, location: resource.location, restorePointId: restorePoint.id },
    });
    return { resource, restorePoint };
  });
}

export async function previewVerifiedRestorePoint(restorePointId: number, tenantId: number | null, audit?: AuditContext) {
  return db.transaction(async (tx) => {
    const [restorePoint] = await tx
      .select()
      .from(selfHealingRestorePointsTable)
      .where(and(eq(selfHealingRestorePointsTable.id, restorePointId), tenantId === null ? isNull(selfHealingRestorePointsTable.tenantId) : eq(selfHealingRestorePointsTable.tenantId, tenantId)))
      .limit(1);
    if (!restorePoint) return null;

    const [resource] = await tx
      .select()
      .from(managedResourcesTable)
      .where(resourceScope(restorePoint.resourceKey, restorePoint.tenantId))
      .limit(1);
    if (!resource) return null;

    const integrityVerified =
      restorePoint.status === "VERIFIED" &&
      hashManagedState(restorePoint.state) === restorePoint.stateHash;
    const sameLocation = resource.location === restorePoint.location;

    const [action] = await tx.insert(selfHealingActionsTable).values({
      tenantId: restorePoint.tenantId,
      restorePointId: restorePoint.id,
      resourceKey: restorePoint.resourceKey,
      location: restorePoint.location,
      mode: "PREVIEW",
      status: integrityVerified && sameLocation ? "READY" : "REJECTED",
      previousStateHash: resource.stateHash,
      restoredStateHash: restorePoint.stateHash,
      message:
        integrityVerified && sameLocation
          ? "Restore point passed hash and same-location verification"
          : "Restore point rejected by hash or same-location verification",
      completedAt: new Date(),
    }).returning();
    if (audit) await appendAudit(tx, {
      tenantId: restorePoint.tenantId, principal: audit.principal, action: "self_healing:restore:preview",
      targetType: "self_healing_action", targetId: String(action.id), decision: "COMMITTED",
      reasonCode: integrityVerified && sameLocation ? "RESTORE_PREVIEW_READY" : "RESTORE_PREVIEW_REJECTED",
      correlationId: audit.correlationId, metadata: { restorePointId, resourceKey: restorePoint.resourceKey },
    });

    return {
      canRestore: integrityVerified && sameLocation,
      restorePointId: restorePoint.id,
      resourceKey: restorePoint.resourceKey,
      location: restorePoint.location,
      currentStateHash: resource.stateHash,
      targetStateHash: restorePoint.stateHash,
      sameLocation,
      integrityVerified,
      executionAllowed: SELF_HEALING_POLICY.executionAllowed,
    };
  });
}

export async function applyVerifiedRestorePoint(input: {
  restorePointId: number;
  tenantId: number | null;
  eventId?: number | null;
  mode: "APPLY" | "AUTO";
  observedState?: JsonRecord;
  audit?: AuditContext;
}) {
  return db.transaction(async (tx) => {
    const [restorePoint] = await tx
      .select()
      .from(selfHealingRestorePointsTable)
      .where(and(eq(selfHealingRestorePointsTable.id, input.restorePointId), input.tenantId === null ? isNull(selfHealingRestorePointsTable.tenantId) : eq(selfHealingRestorePointsTable.tenantId, input.tenantId)))
      .limit(1);
    if (!restorePoint) return null;

    const [resource] = await tx
      .select()
      .from(managedResourcesTable)
      .where(resourceScope(restorePoint.resourceKey, restorePoint.tenantId))
      .limit(1);
    if (!resource) return null;

    const previousStateHash = input.observedState
      ? hashManagedState(input.observedState)
      : resource.stateHash;
    const integrityVerified =
      restorePoint.status === "VERIFIED" &&
      hashManagedState(restorePoint.state) === restorePoint.stateHash;
    const sameLocation = resource.location === restorePoint.location;

    if (!integrityVerified || !sameLocation) {
      const [action] = await tx
        .insert(selfHealingActionsTable)
        .values({
          tenantId: restorePoint.tenantId,
          eventId: input.eventId ?? null,
          restorePointId: restorePoint.id,
          resourceKey: restorePoint.resourceKey,
          location: restorePoint.location,
          mode: input.mode,
          status: "REJECTED",
          previousStateHash,
          restoredStateHash: null,
          message: "Restore rejected: snapshot hash or logical location mismatch",
          completedAt: new Date(),
        })
        .returning();

      await tx
        .update(managedResourcesTable)
        .set({ integrityStatus: "DEGRADED", updatedAt: new Date() })
        .where(eq(managedResourcesTable.id, resource.id));

      if (input.audit) await appendAudit(tx, { tenantId: restorePoint.tenantId, principal: input.audit.principal, action: "self_healing:restore:apply", targetType: "self_healing_action", targetId: String(action.id), decision: "COMMITTED", reasonCode: "RESTORE_REJECTED", correlationId: input.audit.correlationId, metadata: { restorePointId: restorePoint.id, resourceKey: restorePoint.resourceKey } });
      return { resource, action, integrityVerified: false, executionAllowed: false as const };
    }

    const [restoredResource] = await tx
      .update(managedResourcesTable)
      .set({
        state: restorePoint.state,
        stateHash: restorePoint.stateHash,
        integrityStatus: "VERIFIED",
        updatedAt: new Date(),
      })
      .where(eq(managedResourcesTable.id, resource.id))
      .returning();

    const postRestoreVerified =
      hashManagedState(restoredResource.state) === restoredResource.stateHash;

    const [action] = await tx
      .insert(selfHealingActionsTable)
      .values({
        tenantId: restorePoint.tenantId,
        eventId: input.eventId ?? null,
        restorePointId: restorePoint.id,
        resourceKey: restorePoint.resourceKey,
        location: restorePoint.location,
        mode: input.mode,
        status: postRestoreVerified ? "RESTORED" : "FAILED",
        previousStateHash,
        restoredStateHash: postRestoreVerified ? restoredResource.stateHash : null,
        message: postRestoreVerified
          ? "Verified snapshot restored to the original managed location"
          : "Post-restore integrity verification failed",
        completedAt: new Date(),
      })
      .returning();

    if (input.audit) await appendAudit(tx, { tenantId: restorePoint.tenantId, principal: input.audit.principal, action: "self_healing:restore:apply", targetType: "self_healing_action", targetId: String(action.id), decision: "COMMITTED", reasonCode: postRestoreVerified ? "RESTORE_APPLIED" : "RESTORE_VERIFICATION_FAILED", correlationId: input.audit.correlationId, metadata: { restorePointId: restorePoint.id, resourceKey: restorePoint.resourceKey, executionAllowed: false } });
    return {
      resource: restoredResource,
      action,
      integrityVerified: postRestoreVerified,
      executionAllowed: SELF_HEALING_POLICY.executionAllowed,
    };
  });
}

export async function automaticallyRestoreManagedResource(input: {
  resourceKey: string;
  tenantId: number | null;
  eventId: number;
  observedState?: JsonRecord;
}) {
  const [restorePoint] = await db
    .select()
    .from(selfHealingRestorePointsTable)
    .where(restorePointScope(input.resourceKey, input.tenantId))
    .orderBy(desc(selfHealingRestorePointsTable.createdAt))
    .limit(1);

  if (restorePoint) {
    return applyVerifiedRestorePoint({
      restorePointId: restorePoint.id,
      tenantId: input.tenantId,
      eventId: input.eventId,
      mode: "AUTO",
      observedState: input.observedState,
      audit: { principal: { principalId: "self-healing-system", principalType: "SERVICE", tenantIds: input.tenantId === null ? [] : [input.tenantId], roles: [], capabilities: [], authMethod: "SCOPED_CREDENTIAL", credentialVersion: 0, correlationId: `auto-restore:${input.eventId}` }, correlationId: `auto-restore:${input.eventId}` },
    });
  }

  const [resource] = await db
    .select()
    .from(managedResourcesTable)
    .where(resourceScope(input.resourceKey, input.tenantId))
    .limit(1);

  const servicePrincipal: Principal = { principalId: "self-healing-system", principalType: "SERVICE", tenantIds: input.tenantId === null ? [] : [input.tenantId], roles: [], capabilities: [], authMethod: "SCOPED_CREDENTIAL", credentialVersion: 0, correlationId: `auto-restore:${input.eventId}` };
  return db.transaction(async (tx) => {
  const [action] = await tx.insert(selfHealingActionsTable)
    .values({
      tenantId: input.tenantId,
      eventId: input.eventId,
      restorePointId: null,
      resourceKey: input.resourceKey,
      location: resource?.location ?? `managed://unresolved/${input.resourceKey}`,
      mode: "AUTO",
      status: "NO_RESTORE_POINT",
      previousStateHash: input.observedState
        ? hashManagedState(input.observedState)
        : resource?.stateHash ?? null,
      restoredStateHash: null,
      message: "No verified restore point exists; resource remains quarantined",
      completedAt: new Date(),
    })
    .returning();

  if (resource) {
    await tx
      .update(managedResourcesTable)
      .set({ integrityStatus: "QUARANTINED", updatedAt: new Date() })
      .where(eq(managedResourcesTable.id, resource.id));
  }

  await appendAudit(tx, { tenantId: input.tenantId, principal: servicePrincipal, action: "self_healing:restore:auto", targetType: "self_healing_action", targetId: String(action.id), decision: "COMMITTED", reasonCode: "NO_VERIFIED_RESTORE_POINT", correlationId: servicePrincipal.correlationId, metadata: { resourceKey: input.resourceKey, eventId: input.eventId } });
  return {
    resource: resource ?? null,
    action,
    integrityVerified: false,
    executionAllowed: SELF_HEALING_POLICY.executionAllowed,
  };
  });
}