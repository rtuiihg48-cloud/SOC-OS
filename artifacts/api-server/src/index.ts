import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initWebSocket } from "./lib/websocket";
import { setProcessor } from "./lib/queue";
import { db, pool, tenantsTable, rulesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { DEFAULT_SYSTEM_RULES } from "./lib/rules-engine";
import crypto from "crypto";
import { CpuSimulatorScheduler } from "./lib/cpu-simulator";
import { queueStats } from "./lib/queue";
import { callMetaCube } from "./lib/meta-cube-client";
import { bootHckBios, getRequiredHckTables } from "./lib/hck-bios";
import { assertAuditReadiness } from "./lib/audit";
import { bindAfterBios } from "./lib/startup-orchestration";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
const cpuSimulator = new CpuSimulatorScheduler();

// ── WebSocket (V30 realtime broadcast) ───────────────────────────────────────
initWebSocket(server);

// ── Queue processor (V50 ingest pipeline) ────────────────────────────────────
// The queue receives events from POST /events; we register a processor so
// queue stats reflect real activity. Processing is also done synchronously
// in the route for the request-response cycle, but the queue enables burst
// buffering and async analytics pipelines in production.
setProcessor(async (item) => {
  logger.debug({ event: item.event, source: item.source }, "Queue item processed");
});

// ── Seed default data on startup ──────────────────────────────────────────────
async function seedDefaultData() {
  try {
    // Ensure a default "System" tenant exists (id=1)
    const [tenantCount] = await db.select({ count: count() }).from(tenantsTable);
    if (Number(tenantCount?.count ?? 0) === 0) {
      await db.insert(tenantsTable).values({
        name: "System",
        apiKey: "soc_" + crypto.randomBytes(20).toString("hex"),
        plan: "enterprise",
      });
      logger.info("Seeded default System tenant");
    }

    // Seed default system rules if none exist
    const [rulesCount] = await db.select({ count: count() }).from(rulesTable);
    if (Number(rulesCount?.count ?? 0) === 0) {
      await db.insert(rulesTable).values(
        DEFAULT_SYSTEM_RULES.map((r) => ({
          tenantId: null,
          name: r.name,
          description: r.description,
          matchPattern: r.matchPattern,
          scoreBoost: r.scoreBoost,
          forceAction: r.forceAction,
          severity: r.severity,
          enabled: true,
        }))
      );
      logger.info({ count: DEFAULT_SYSTEM_RULES.length }, "Seeded default system rules");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed default data");
  }
}

async function startServer() {
  const production = process.env["NODE_ENV"] === "production";
  const auditReadiness = await assertAuditReadiness(pool, production);
  if (!auditReadiness.ready) {
    logger.warn({ failures: auditReadiness.failures }, "Audit readiness is not enforced outside production");
  }
  const bios = await bootHckBios({
    async checkDatabase() {
      const result = await pool.query<{ ok: number }>("SELECT 1 AS ok");
      return { connected: result.rows[0]?.ok === 1 };
    },
    async checkSchema() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [getRequiredHckTables()],
      );
      const present = new Set(result.rows.map((row) => row.table_name));
      return { missing: getRequiredHckTables().filter((table) => !present.has(table)) };
    },
    async checkMetaCube() {
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          return await callMetaCube("healthz", {
            correlationId: "hck-bios-boot",
            context: { tenantId: 1, principalType: "SERVICE", principalId: "api-server-bios", capability: "execution:health", correlationId: "hck-bios-boot" },
          }) as Record<string, unknown>;
        } catch (error) {
          lastError = error;
          if (attempt < 4) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
      throw lastError;
    },
    getQueueStatus: () => queueStats(),
  });
  logger.info({ status: bios.status, stages: bios.stages }, "HCK-BIOS boot complete");
  bindAfterBios(bios, production, (onListening) => {
    server.listen(port, async () => {
      logger.info({ port }, "SOC-OS V50 server listening");
      await seedDefaultData();
      onListening();
    });
  }, () => {
    cpuSimulator.start();
  });
}

void startServer().catch((err) => {
  logger.fatal({ err }, "Server startup failed control-plane readiness");
  void pool.end().finally(() => process.exit(1));
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, "Stopping SOC-OS services");
    await cpuSimulator.stop();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  });
}
