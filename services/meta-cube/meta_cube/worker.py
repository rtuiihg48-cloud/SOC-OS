from __future__ import annotations

import asyncio
import json
from contextlib import suppress

from .engine import ExecutionEngine
from .models import ExecutionStatus
from .redis_stream import RedisStreamAdapter


class ExecutionWorker:
    """Lifespan-managed single-process worker for local queues or Redis Streams."""

    stream = "meta-cube:events"
    group = "meta-cube-workers"

    def __init__(self, engine: ExecutionEngine, redis: RedisStreamAdapter, consumer: str = "local-worker") -> None:
        self.engine, self.redis, self.consumer = engine, redis, consumer
        self.queue: asyncio.Queue[str | None] = asyncio.Queue()
        self.task: asyncio.Task[None] | None = None
        self.local_task: asyncio.Task[None] | None = None
        self.running = False
        self.busy = False
        self.transport_degraded = False

    @property
    def state(self) -> str:
        if not self.running:
            return "stopped"
        return "running" if self.busy else "idle"

    async def start(self) -> None:
        self.running = True
        # Always keep the local consumer alive. It is the authoritative
        # fallback while a configured Redis transport is reconnecting.
        self.local_task = asyncio.create_task(self._local_loop())
        if self.redis.available or getattr(self.redis, "configured", False):
            try:
                await self.redis.ensure_group(self.stream, self.group)
                await self._resume_persisted(redis_enqueue=True)
                await self.reclaim()
            except Exception:
                # The loop owns recovery; startup must not make durable local
                # records unavailable just because Redis has a transient outage.
                self.transport_degraded = True
                await self._resume_persisted(redis_enqueue=False)
            self.task = asyncio.create_task(self._redis_loop())
        else:
            await self._resume_persisted(redis_enqueue=False)
            # The local task was started above, so recovered records are
            # already queued without a second consumer.
            return

    async def stop(self) -> None:
        self.running = False
        await self.queue.put(None)
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None
        if self.local_task:
            self.local_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.local_task
            self.local_task = None

    async def submit(self, execution_id: str) -> None:
        if self.redis.available:
            # XADD completes before this method returns: Redis owns delivery.
            try:
                await self.redis.publish(self.stream, {"execution_id": execution_id})
            except Exception:
                # Invalidate the failed client before local fallback. Otherwise
                # the Redis loop can keep treating a broken XADD transport as
                # available and never enter its reconnect/outbox-rescan path.
                self.transport_degraded = True
                try:
                    await self.redis.close()
                except Exception:
                    pass
                await self.queue.put(execution_id)
        else:
            await self.queue.put(execution_id)

    async def _resume_persisted(self, redis_enqueue: bool) -> None:
        resumable = {ExecutionStatus.CREATED, ExecutionStatus.RUNNING, ExecutionStatus.RETRY_WAIT}
        for record in self.engine.list():
            if record.status in resumable:
                if redis_enqueue:
                    await self.redis.publish(self.stream, {"execution_id": record.id})
                else:
                    await self.queue.put(record.id)

    async def _local_loop(self) -> None:
        while self.running:
            execution_id = await self.queue.get()
            if execution_id is None:
                return
            await self._process(execution_id)

    async def _redis_loop(self) -> None:
        delay = 0.05
        while self.running:
            try:
                if not self.redis.available:
                    connected = await self.redis.connect()
                    if not connected:
                        raise RuntimeError("Redis reconnect failed")
                await self.redis.ensure_group(self.stream, self.group)
                # This is a durable outbox scan. Repeated XADDs are safe:
                # execution_id is the idempotency key at the worker boundary.
                await self._resume_persisted(redis_enqueue=True)
                messages = await self.redis.read_group(
                    self.stream, self.group, self.consumer, count=10, block_ms=250
                )
                for _, entries in messages or []:
                    for message_id, fields in entries:
                        try:
                            await self._process(self._execution_id(fields))
                        except Exception:
                            # Leave pending. Reclaim will give it another at-least-once delivery.
                            continue
                        await self.redis.xack(self.stream, self.group, message_id)
                await self.reclaim()
                self.transport_degraded = False
                delay = 0.05
            except asyncio.CancelledError:
                raise
            except Exception:
                # Read, claim, and publish failures all keep state in FileStore.
                # Retry transport with a bounded reconnect backoff.
                self.transport_degraded = True
                self.busy = False
                try:
                    await self.redis.close()
                except Exception:
                    pass
                await asyncio.sleep(delay)
                delay = min(delay * 2, 2.0)

    async def reclaim(self) -> None:
        if not self.redis.available:
            return
        claimed = await self.redis.autoclaim(self.stream, self.group, self.consumer, min_idle_ms=1)
        # redis-py returns (next_start, entries, deleted) for XAUTOCLAIM;
        # fallback returns entries. Process then acknowledge only after persistence.
        entries = claimed[1] if isinstance(claimed, (tuple, list)) and claimed and isinstance(claimed[0], str) else claimed
        for message_id, fields in entries or []:
            try:
                await self._process(self._execution_id(fields))
            except Exception:
                continue
            await self.redis.xack(self.stream, self.group, message_id)

    async def _process(self, execution_id: str) -> None:
        self.busy = True
        try:
            self.engine.execute(execution_id)
        finally:
            self.busy = False

    @staticmethod
    def _execution_id(fields: dict[str, str]) -> str:
        if "execution_id" in fields:
            return fields["execution_id"]
        return json.loads(fields["event"])["execution_id"]