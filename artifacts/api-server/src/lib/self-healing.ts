import { createHash } from "node:crypto";
import {
  db,
  managedResourcesTable,
  selfHealingActionsTable,
  selfHealingRestorePointsTable,
} from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";

export const SELF_HEALING_POLICY = {
  maxStateBytes: 64 * 1024,
  executionAllowed: false as const,
  locationPrefix: "managed://" as const,
};

type JsonRecord = Record<string, unknown>;

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

    return { resource, restorePoint };
  });
}

export async function previewVerifiedRestorePoint(restorePointId: number) {
  return db.transaction(async (tx) => {
    const [restorePoint] = await tx
      .select()
      .from(selfHealingRestorePointsTable)
      .where(eq(selfHealingRestorePointsTable.id, restorePointId))
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

    await tx.insert(selfHealingActionsTable).values({
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
  eventId?: number | null;
  mode: "APPLY" | "AUTO";
  observedState?: JsonRecord;
}) {
  return db.transaction(async (tx) => {
    const [restorePoint] = await tx
      .select()
      .from(selfHealingRestorePointsTable)
      .where(eq(selfHealingRestorePointsTable.id, input.restorePointId))
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
      eventId: input.eventId,
      mode: "AUTO",
      observedState: input.observedState,
    });
  }

  const [resource] = await db
    .select()
    .from(managedResourcesTable)
    .where(resourceScope(input.resourceKey, input.tenantId))
    .limit(1);

  const [action] = await db
    .insert(selfHealingActionsTable)
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
    await db
      .update(managedResourcesTable)
      .set({ integrityStatus: "QUARANTINED", updatedAt: new Date() })
      .where(eq(managedResourcesTable.id, resource.id));
  }

  return {
    resource: resource ?? null,
    action,
    integrityVerified: false,
    executionAllowed: SELF_HEALING_POLICY.executionAllowed,
  };
}