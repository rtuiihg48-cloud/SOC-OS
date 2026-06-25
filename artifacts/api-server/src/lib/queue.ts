// ─── Ingest Queue ─────────────────────────────────────────────────────────────
// Lightweight in-process FIFO queue for the SOC ingest pipeline.
// In production this would be Kafka or SQS, but this in-memory version
// demonstrates the architecture and handles burst scenarios gracefully.

import { logger } from "./logger";

export interface QueuedEvent {
  event: string;
  tenantId: number | null;
  cpuUsage?: number;
  memUsage?: number;
  enqueuedAt: number;
  source: "api" | "simulation" | "self-test" | "stream";
}

export type QueueProcessor = (item: QueuedEvent) => Promise<void>;

const queue: QueuedEvent[] = [];
const MAX_QUEUE_SIZE = 1000;
let processor: QueueProcessor | null = null;
let isProcessing = false;

// ─── Enqueue an event ─────────────────────────────────────────────────────────
export function enqueue(item: QueuedEvent): boolean {
  if (queue.length >= MAX_QUEUE_SIZE) {
    logger.warn({ queueSize: queue.length }, "Ingest queue full — dropping event");
    return false;
  }
  queue.push(item);
  scheduleProcess();
  return true;
}

// ─── Register the processor callback ─────────────────────────────────────────
export function setProcessor(fn: QueueProcessor): void {
  processor = fn;
}

// ─── Queue stats ──────────────────────────────────────────────────────────────
export function queueStats() {
  return {
    pending: queue.length,
    maxSize: MAX_QUEUE_SIZE,
    hasProcessor: processor !== null,
    isProcessing,
  };
}

// ─── Internal: process one item at a time ────────────────────────────────────
function scheduleProcess(): void {
  if (isProcessing || !processor || queue.length === 0) return;

  setImmediate(async () => {
    if (isProcessing || !processor || queue.length === 0) return;
    isProcessing = true;

    const item = queue.shift()!;
    try {
      await processor(item);
    } catch (err) {
      logger.error({ err, event: item.event }, "Queue processor error");
    } finally {
      isProcessing = false;
      if (queue.length > 0) scheduleProcess();
    }
  });
}
