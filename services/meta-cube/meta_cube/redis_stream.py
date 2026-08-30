from __future__ import annotations

import json
from typing import Any


class RedisStreamAdapter:
    """Optional Redis Streams adapter; local file state remains authoritative here."""

    def __init__(self, url: str | None) -> None:
        self.url = url
        self.client: Any | None = None
        self.error: str | None = None

    @property
    def configured(self) -> bool:
        return bool(self.url)

    @property
    def available(self) -> bool:
        return self.client is not None

    async def connect(self) -> bool:
        if not self.url:
            return False
        try:
            import redis.asyncio as redis

            client = redis.from_url(self.url, decode_responses=True)
            await client.ping()
            self.client = client
            self.error = None
            return True
        except Exception as exc:  # optional infrastructure must not disable local mode
            self.client = None
            self.error = str(exc)
            return False

    async def close(self) -> None:
        if self.client is not None:
            await self.client.aclose()
            self.client = None

    def _client(self) -> Any:
        if self.client is None:
            raise RuntimeError("Redis is not available; local file persistence is active")
        return self.client

    async def publish(self, stream: str, event: dict[str, Any]) -> str:
        return await self._client().xadd(stream, {"event": json.dumps(event, sort_keys=True)})

    async def ensure_group(self, stream: str, group: str) -> None:
        try:
            await self._client().xgroup_create(stream, group, id="0", mkstream=True)
        except Exception as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    async def read_group(self, stream: str, group: str, consumer: str, count: int = 10,
                         block_ms: int = 250) -> Any:
        return await self._client().xreadgroup(group, consumer, {stream: ">"}, count=count, block=block_ms)

    async def xack(self, stream: str, group: str, message_id: str) -> int:
        return await self._client().xack(stream, group, message_id)

    async def autoclaim(self, stream: str, group: str, consumer: str, min_idle_ms: int) -> Any:
        """Use XAUTOCLAIM, with XPENDING/XCLAIM for older Redis servers."""
        client = self._client()
        try:
            return await client.xautoclaim(stream, group, consumer, min_idle_ms, "0-0", count=100)
        except Exception:
            pending = await client.xpending_range(stream, group, "-", "+", 100, idle=min_idle_ms)
            ids = [entry["message_id"] for entry in pending]
            return await client.xclaim(stream, group, consumer, min_idle_ms, ids) if ids else []