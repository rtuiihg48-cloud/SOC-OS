import { Router } from "express";
import {
  db,
  virusCatalogEntriesTable,
  virusDatabaseAuditTable,
  virusFamiliesTable,
  virusFeedImportsTable,
  virusFeedSourcesTable,
  virusIndicatorsTable,
  virusMatchesTable,
  virusSampleAccessTable,
  virusSamplesTable,
} from "@workspace/db";
import {
  CreateVirusEntryBody,
  CreateVirusFeedBody,
  ListVirusDatabaseAuditQueryParams,
  ListVirusEntriesQueryParams,
  ListVirusMatchesQueryParams,
  ListVirusSamplesQueryParams,
  LookupVirusIndicatorBody,
  RegisterVirusSampleBody,
  RequestVirusSampleDownloadBody,
  SyncVirusFeedBody,
} from "@workspace/api-zod";
import { and, count, desc, eq, ilike, inArray } from "drizzle-orm";

const router = Router();
const SHA256 = /^[0-9a-f]{64}$/;
const EXECUTION_ALLOWED = false as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function hasDatabaseCode(error: unknown, expected: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === expected) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function principal(req: { get(name: string): string | undefined }) {
  return req.get("x-principal-ref")?.slice(0, 200) || "api:anonymous";
}

async function audit(
  executor: typeof db | Tx,
  input: {
    tenantId?: number | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    principalRef: string;
    outcome: "ALLOWED" | "DENIED" | "COMPLETED" | "FAILED";
    details?: Record<string, unknown>;
  },
) {
  await executor.insert(virusDatabaseAuditTable).values({
    tenantId: input.tenantId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    principalRef: input.principalRef,
    outcome: input.outcome,
    details: input.details ?? {},
  });
}

function formatIndicator(row: typeof virusIndicatorsTable.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function formatMatch(row: typeof virusMatchesTable.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function formatSample(row: typeof virusSamplesTable.$inferSelect) {
  return {
    ...row,
    retentionUntil: row.retentionUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    executionAllowed: EXECUTION_ALLOWED,
  };
}

function formatFeed(row: typeof virusFeedSourcesTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatFeedImport(row: typeof virusFeedImportsTable.$inferSelect) {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function hydrateEntries(ids?: number[]) {
  const rows = await db
    .select({
      entry: virusCatalogEntriesTable,
      familyName: virusFamiliesTable.canonicalName,
      familyAliases: virusFamiliesTable.aliases,
    })
    .from(virusCatalogEntriesTable)
    .leftJoin(virusFamiliesTable, eq(virusCatalogEntriesTable.familyId, virusFamiliesTable.id))
    .where(ids ? inArray(virusCatalogEntriesTable.id, ids) : undefined)
    .orderBy(desc(virusCatalogEntriesTable.updatedAt));

  if (rows.length === 0) return [];
  const indicators = await db
    .select()
    .from(virusIndicatorsTable)
    .where(inArray(virusIndicatorsTable.catalogEntryId, rows.map(({ entry }) => entry.id)))
    .orderBy(desc(virusIndicatorsTable.createdAt));
  const byEntry = new Map<number, ReturnType<typeof formatIndicator>[]>();
  for (const indicator of indicators) {
    const list = byEntry.get(indicator.catalogEntryId) ?? [];
    list.push(formatIndicator(indicator));
    byEntry.set(indicator.catalogEntryId, list);
  }

  return rows.map(({ entry, familyName, familyAliases }) => ({
    ...entry,
    familyName: familyName ?? null,
    familyAliases: familyAliases ?? [],
    firstSeen: entry.firstSeen?.toISOString() ?? null,
    lastSeen: entry.lastSeen?.toISOString() ?? null,
    indicators: byEntry.get(entry.id) ?? [],
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }));
}

router.get("/virus-db/stats", async (_req, res) => {
  const [[entries], [indicators], [samples], [matches], [feeds]] = await Promise.all([
    db.select({ value: count() }).from(virusCatalogEntriesTable),
    db.select({ value: count() }).from(virusIndicatorsTable).where(eq(virusIndicatorsTable.status, "ACTIVE")),
    db.select({ value: count() }).from(virusSamplesTable).where(eq(virusSamplesTable.status, "QUARANTINED")),
    db.select({ value: count() }).from(virusMatchesTable).where(eq(virusMatchesTable.matchType, "EXACT_HASH")),
    db.select({ value: count() }).from(virusFeedSourcesTable).where(eq(virusFeedSourcesTable.status, "ACTIVE")),
  ]);
  res.json({
    catalogEntries: entries.value,
    activeIndicators: indicators.value,
    quarantinedSamples: samples.value,
    exactMatches: matches.value,
    activeFeeds: feeds.value,
    binaryStorageReady: false,
    executionAllowed: EXECUTION_ALLOWED,
  });
});

router.get("/virus-db/entries", async (req, res) => {
  const parsed = ListVirusEntriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid virus catalog query" });
    return;
  }
  const filters = [];
  if (parsed.data.search) filters.push(ilike(virusCatalogEntriesTable.canonicalName, `%${parsed.data.search}%`));
  if (parsed.data.severity) filters.push(eq(virusCatalogEntriesTable.severity, parsed.data.severity));
  if (parsed.data.status) filters.push(eq(virusCatalogEntriesTable.status, parsed.data.status));

  const entries = await db
    .select({ id: virusCatalogEntriesTable.id })
    .from(virusCatalogEntriesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(virusCatalogEntriesTable.updatedAt))
    .limit(parsed.data.limit ?? 100);
  res.json(await hydrateEntries(entries.map(({ id }) => id)));
});

router.get("/virus-db/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid virus entry id" });
    return;
  }
  const [entry] = await hydrateEntries([id]);
  if (!entry) {
    res.status(404).json({ error: "Virus entry not found" });
    return;
  }
  res.json(entry);
});

router.post("/virus-db/entries", async (req, res) => {
  const parsed = CreateVirusEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid virus catalog entry" });
    return;
  }
  const sha256 = parsed.data.sha256.toLowerCase();
  if (!SHA256.test(sha256)) {
    res.status(400).json({ error: "Invalid SHA-256" });
    return;
  }

  try {
    const entryId = await db.transaction(async (tx) => {
      let familyId: number | null = null;
      if (parsed.data.familyName) {
        const [existing] = await tx
          .select()
          .from(virusFamiliesTable)
          .where(ilike(virusFamiliesTable.canonicalName, parsed.data.familyName))
          .limit(1);
        const [family] = existing
          ? [existing]
          : await tx
              .insert(virusFamiliesTable)
              .values({
                canonicalName: parsed.data.familyName,
                aliases: parsed.data.familyAliases ?? [],
                description: parsed.data.description ?? null,
              })
              .returning();
        familyId = family.id;
      }

      let sourceId: number | null = null;
      if (parsed.data.sourceName) {
        const [existing] = await tx
          .select()
          .from(virusFeedSourcesTable)
          .where(ilike(virusFeedSourcesTable.name, parsed.data.sourceName))
          .limit(1);
        const [source] = existing
          ? [existing]
          : await tx
              .insert(virusFeedSourcesTable)
              .values({ name: parsed.data.sourceName, adapterKind: "MANUAL" })
              .returning();
        sourceId = source.id;
      }

      const now = new Date();
      const [entry] = await tx
        .insert(virusCatalogEntriesTable)
        .values({
          familyId,
          canonicalName: parsed.data.canonicalName,
          description: parsed.data.description ?? null,
          severity: parsed.data.severity,
          confidence: parsed.data.confidence,
          firstSeen: now,
          lastSeen: now,
        })
        .returning();
      await tx.insert(virusIndicatorsTable).values({
        catalogEntryId: entry.id,
        sourceId,
        indicatorType: "SHA256",
        normalizedValue: sha256,
        confidence: parsed.data.confidence,
      });
      await audit(tx, {
        action: "CATALOG_ENTRY_CREATED",
        entityType: "virus_catalog_entry",
        entityId: entry.id,
        principalRef: principal(req),
        outcome: "COMPLETED",
        details: { sha256, sourceId, indicatorType: "SHA256" },
      });
      return entry.id;
    });
    const [entry] = await hydrateEntries([entryId]);
    res.status(201).json(entry);
  } catch (error) {
    if (hasDatabaseCode(error, "23505")) {
      res.status(409).json({ error: "SHA-256 indicator or catalog identity already exists" });
      return;
    }
    throw error;
  }
});

router.post("/virus-db/indicators/lookup", async (req, res) => {
  const parsed = LookupVirusIndicatorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid SHA-256 lookup" });
    return;
  }
  const sha256 = parsed.data.sha256.toLowerCase();
  const [indicator] = await db
    .select()
    .from(virusIndicatorsTable)
    .where(and(
      eq(virusIndicatorsTable.indicatorType, "SHA256"),
      eq(virusIndicatorsTable.normalizedValue, sha256),
      eq(virusIndicatorsTable.status, "ACTIVE"),
    ))
    .limit(1);

  if (!indicator) {
    await audit(db, {
      tenantId: parsed.data.tenantId ?? null,
      action: "EXACT_HASH_LOOKUP",
      entityType: "virus_indicator",
      principalRef: principal(req),
      outcome: "COMPLETED",
      details: { matched: false, sha256 },
    });
    res.json({
      matched: false,
      sha256,
      entry: null,
      match: null,
      recommendedAction: "NONE",
      executionAllowed: EXECUTION_ALLOWED,
    });
    return;
  }

  const [entry] = await hydrateEntries([indicator.catalogEntryId]);
  let match: ReturnType<typeof formatMatch> | null = null;
  if (parsed.data.eventId) {
    const [row] = await db
      .insert(virusMatchesTable)
      .values({
        tenantId: parsed.data.tenantId ?? null,
        eventId: parsed.data.eventId,
        indicatorId: indicator.id,
        matchType: "EXACT_HASH",
        matchedValue: sha256,
        confidence: indicator.confidence,
        severity: entry.severity,
        sourceId: indicator.sourceId,
        nodeId: parsed.data.nodeId ?? null,
        hostId: parsed.data.hostId ?? null,
        vmId: parsed.data.vmId ?? null,
        evidenceReference: `event:${parsed.data.eventId}:sha256:${sha256}`,
      })
      .returning();
    match = formatMatch(row);
  }
  await audit(db, {
    tenantId: parsed.data.tenantId ?? null,
    action: "EXACT_HASH_LOOKUP",
    entityType: "virus_indicator",
    entityId: indicator.id,
    principalRef: principal(req),
    outcome: "COMPLETED",
    details: { matched: true, sha256, eventId: parsed.data.eventId ?? null },
  });
  res.json({
    matched: true,
    sha256,
    entry,
    match,
    recommendedAction: entry.severity === "CRITICAL" || entry.severity === "HIGH" ? "ISOLATE" : "WARN",
    executionAllowed: EXECUTION_ALLOWED,
  });
});

router.get("/virus-db/samples", async (req, res) => {
  const parsed = ListVirusSamplesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sample query" });
    return;
  }
  const filters = [];
  if (parsed.data.tenantId) filters.push(eq(virusSamplesTable.tenantId, parsed.data.tenantId));
  if (parsed.data.status) filters.push(eq(virusSamplesTable.status, parsed.data.status));
  const rows = await db
    .select()
    .from(virusSamplesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(virusSamplesTable.createdAt))
    .limit(parsed.data.limit ?? 100);
  res.json(rows.map(formatSample));
});

router.post("/virus-db/samples/intake", async (req, res) => {
  const parsed = RegisterVirusSampleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid or oversized sample metadata" });
    return;
  }
  const sha256 = parsed.data.sha256.toLowerCase();
  try {
    const sample = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(virusSamplesTable)
        .values({
          tenantId: parsed.data.tenantId ?? null,
          catalogEntryId: parsed.data.catalogEntryId ?? null,
          sha256,
          objectPath: null,
          sizeBytes: parsed.data.sizeBytes,
          declaredName: parsed.data.declaredName ?? null,
          declaredContentType: parsed.data.declaredContentType ?? null,
          sourceType: parsed.data.sourceType,
          sourceReference: parsed.data.sourceReference ?? null,
          status: "QUARANTINED",
        })
        .returning();
      await audit(tx, {
        tenantId: row.tenantId,
        action: "SAMPLE_METADATA_REGISTERED",
        entityType: "virus_sample",
        entityId: row.id,
        principalRef: principal(req),
        outcome: "COMPLETED",
        details: { sha256, sizeBytes: row.sizeBytes, binaryStored: false },
      });
      return row;
    });
    res.status(201).json(formatSample(sample));
  } catch (error) {
    if (hasDatabaseCode(error, "23505")) {
      res.status(409).json({ error: "Sample SHA-256 already registered in this tenant scope" });
      return;
    }
    throw error;
  }
});

router.post("/virus-db/samples/:id/download-request", async (req, res) => {
  const sampleId = Number(req.params.id);
  const parsed = RequestVirusSampleDownloadBody.safeParse(req.body);
  if (!Number.isInteger(sampleId) || sampleId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid sample access request" });
    return;
  }
  const [sample] = await db.select().from(virusSamplesTable).where(eq(virusSamplesTable.id, sampleId)).limit(1);
  if (!sample) {
    res.status(404).json({ error: "Sample not found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.insert(virusSampleAccessTable).values({
      tenantId: sample.tenantId,
      sampleId,
      principalRef: principal(req),
      capability: "DOWNLOAD",
      purpose: parsed.data.purpose,
      decision: "DENIED",
    });
    await audit(tx, {
      tenantId: sample.tenantId,
      action: "SAMPLE_DOWNLOAD_REQUEST",
      entityType: "virus_sample",
      entityId: sampleId,
      principalRef: principal(req),
      outcome: "DENIED",
      details: { reason: "AUTHORIZATION_EXECUTION_PLANE_NOT_CONFIGURED" },
    });
  });
  res.status(403).json({ error: "Private sample download is disabled until authorization is configured" });
});

router.get("/virus-db/feeds", async (_req, res) => {
  const rows = await db.select().from(virusFeedSourcesTable).orderBy(desc(virusFeedSourcesTable.updatedAt));
  res.json(rows.map(formatFeed));
});

router.post("/virus-db/feeds", async (req, res) => {
  const parsed = CreateVirusFeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid feed source" });
    return;
  }
  try {
    const source = await db.transaction(async (tx) => {
      const [row] = await tx.insert(virusFeedSourcesTable).values({
        name: parsed.data.name,
        adapterKind: parsed.data.adapterKind,
        description: parsed.data.description ?? null,
      }).returning();
      await audit(tx, {
        action: "FEED_SOURCE_CREATED",
        entityType: "virus_feed_source",
        entityId: row.id,
        principalRef: principal(req),
        outcome: "COMPLETED",
        details: { adapterKind: row.adapterKind },
      });
      return row;
    });
    res.status(201).json(formatFeed(source));
  } catch (error) {
    if (hasDatabaseCode(error, "23505")) {
      res.status(409).json({ error: "Feed source already exists" });
      return;
    }
    throw error;
  }
});

router.post("/virus-db/feeds/:id/sync", async (req, res) => {
  const sourceId = Number(req.params.id);
  const parsed = SyncVirusFeedBody.safeParse(req.body);
  if (!Number.isInteger(sourceId) || sourceId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid feed import request" });
    return;
  }
  const [source] = await db.select().from(virusFeedSourcesTable).where(eq(virusFeedSourcesTable.id, sourceId)).limit(1);
  if (!source) {
    res.status(404).json({ error: "Feed source not found" });
    return;
  }
  try {
    const imported = await db.transaction(async (tx) => {
      const [row] = await tx.insert(virusFeedImportsTable).values({
        sourceId,
        sourceVersion: parsed.data.sourceVersion,
        cursor: parsed.data.cursor ?? null,
        status: "COMPLETED",
        importedCount: parsed.data.importedCount ?? 0,
        rejectedCount: parsed.data.rejectedCount ?? 0,
        deduplicatedCount: parsed.data.deduplicatedCount ?? 0,
        completedAt: new Date(),
      }).returning();
      await audit(tx, {
        action: "FEED_IMPORT_RECORDED",
        entityType: "virus_feed_import",
        entityId: row.id,
        principalRef: principal(req),
        outcome: "COMPLETED",
        details: { sourceId, sourceVersion: row.sourceVersion },
      });
      return row;
    });
    res.status(201).json(formatFeedImport(imported));
  } catch (error) {
    if (hasDatabaseCode(error, "23505")) {
      res.status(409).json({ error: "This feed version was already imported" });
      return;
    }
    throw error;
  }
});

router.get("/virus-db/matches", async (req, res) => {
  const parsed = ListVirusMatchesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid virus match query" });
    return;
  }
  const rows = await db.select().from(virusMatchesTable)
    .where(parsed.data.tenantId ? eq(virusMatchesTable.tenantId, parsed.data.tenantId) : undefined)
    .orderBy(desc(virusMatchesTable.createdAt))
    .limit(parsed.data.limit ?? 100);
  res.json(rows.map(formatMatch));
});

router.get("/virus-db/audit", async (req, res) => {
  const parsed = ListVirusDatabaseAuditQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid virus audit query" });
    return;
  }
  const rows = await db.select().from(virusDatabaseAuditTable)
    .where(parsed.data.tenantId ? eq(virusDatabaseAuditTable.tenantId, parsed.data.tenantId) : undefined)
    .orderBy(desc(virusDatabaseAuditTable.createdAt))
    .limit(parsed.data.limit ?? 100);
  res.json(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
});

export default router;