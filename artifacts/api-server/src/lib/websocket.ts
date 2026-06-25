import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { logger } from "./logger";

// ─── WebSocket Broadcast Layer ────────────────────────────────────────────────
// Bidirectional realtime channel for SOC events.
// Clients can subscribe to specific tenants by sending a JSON message:
//   { "type": "subscribe", "tenantId": 1 }
// Server pushes structured event payloads to all subscribed clients.

interface AnnotatedSocket extends WebSocket {
  tenantId?: number;
  isAlive?: boolean;
}

export let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  // HTTP upgrade for WebSocket
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url === "/ws") {
      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: AnnotatedSocket) => {
    ws.isAlive = true;
    ws.tenantId = undefined;

    logger.info("WebSocket client connected");

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "subscribe" && typeof msg.tenantId === "number") {
          ws.tenantId = msg.tenantId;
          ws.send(JSON.stringify({ type: "subscribed", tenantId: msg.tenantId }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      logger.info("WebSocket client disconnected");
    });

    ws.send(JSON.stringify({ type: "connected", message: "SOC-OS WebSocket v2.0" }));
  });

  // Heartbeat — prune dead connections every 30s
  const heartbeat = setInterval(() => {
    wss!.clients.forEach((ws) => {
      const client = ws as AnnotatedSocket;
      if (!client.isAlive) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  logger.info("WebSocket server initialized at /ws");
}

// ─── Broadcast to all clients (optionally tenant-filtered) ───────────────────
export function broadcast(payload: unknown, tenantId?: number): void {
  if (!wss) return;

  const message = JSON.stringify(payload);

  wss.clients.forEach((ws) => {
    const client = ws as AnnotatedSocket;
    if (client.readyState !== WebSocket.OPEN) return;
    // If tenantId specified, only send to matching subscribers OR unsubscribed clients
    if (tenantId !== undefined && client.tenantId !== undefined && client.tenantId !== tenantId) return;
    client.send(message);
  });
}
