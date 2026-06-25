import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initWebSocket } from "./lib/websocket";
import { setProcessor } from "./lib/queue";
import { db, tenantsTable, rulesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { DEFAULT_SYSTEM_RULES } from "./lib/rules-engine";
import crypto from "crypto";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

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

server.listen(port, async () => {
  logger.info({ port }, "SOC-OS V50 server listening");
  await seedDefaultData();
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
