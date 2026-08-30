import asyncio

import pytest

from meta_cube.engine import ExecutionEngine
from meta_cube.models import EventRequest, StepSpec
from meta_cube.redis_stream import RedisStreamAdapter
from meta_cube.worker import ExecutionWorker


class FakeStream:
    def __init__(self):
        self.groups = []
        self.published = []
        self.acks = []
        self.delivered = False

    @property
    def available(self):
        return True

    async def ensure_group(self, stream, group):
        self.groups.append((stream, group))

    async def publish(self, stream, event):
        self.published.append((stream, event))
        return "1-0"

    async def read_group(self, stream, group, consumer, **_):
        if not self.delivered and self.published:
            self.delivered = True
            event = self.published[0][1]
            return [(stream, [("1-0", {"execution_id": event["execution_id"]})])]
        await asyncio.sleep(0.01)
        return []

    async def autoclaim(self, *_args, **_kwargs):
        return []

    async def xack(self, stream, group, message_id):
        self.acks.append((stream, group, message_id))
        return 1


@pytest.mark.asyncio
async def test_redis_worker_creates_group_persists_then_acks(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    record = engine.accept(EventRequest(steps=[StepSpec(id="one", action="value", value=1)]))
    stream = FakeStream()
    worker = ExecutionWorker(engine, stream)
    await worker.start()
    await asyncio.sleep(0.04)
    await worker.stop()
    assert ("meta-cube:events", "meta-cube-workers") in stream.groups
    assert engine.get(record.id).status.value == "completed"
    assert stream.acks == [("meta-cube:events", "meta-cube-workers", "1-0")]


@pytest.mark.asyncio
async def test_local_worker_recovers_queued_work_and_stops(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    record = engine.accept(EventRequest(steps=[StepSpec(id="one", action="value", value=1)]))
    worker = ExecutionWorker(engine, type("Local", (), {"available": False})())
    await worker.start()
    await asyncio.sleep(0.02)
    await worker.stop()
    assert engine.get(record.id).status.value == "completed"
    assert worker.state == "stopped"


class OldRedis:
    async def xautoclaim(self, *_args, **_kwargs):
        raise RuntimeError("unknown command")

    async def xpending_range(self, *_args, **_kwargs):
        return [{"message_id": "9-0"}]

    async def xclaim(self, *_args, **_kwargs):
        return [("9-0", {"event": "{}"})]


@pytest.mark.asyncio
async def test_autoclaim_uses_pending_claim_fallback():
    adapter = RedisStreamAdapter("redis://configured")
    adapter.client = OldRedis()
    claimed = await adapter.autoclaim("stream", "group", "consumer", 1)
    assert claimed[0][0] == "9-0"


class FlakyStream(FakeStream):
    def __init__(self):
        super().__init__()
        self.fail_publish = True
        self.fail_read = True
        self.reconnects = 0
        self.connected = True

    @property
    def available(self):
        return self.connected

    @property
    def configured(self):
        return True

    async def publish(self, stream, event):
        if self.fail_publish:
            self.fail_publish = False
            raise RuntimeError("temporary XADD outage")
        return await super().publish(stream, event)

    async def read_group(self, *args, **kwargs):
        if self.fail_read:
            self.fail_read = False
            raise RuntimeError("temporary XREADGROUP outage")
        return await super().read_group(*args, **kwargs)

    async def close(self):
        self.connected = False

    async def connect(self):
        self.reconnects += 1
        self.connected = True
        return True


@pytest.mark.asyncio
async def test_transport_outages_republish_durable_acceptance_without_restart(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    stream = FlakyStream()
    worker = ExecutionWorker(engine, stream)
    await worker.start()
    record = engine.accept(EventRequest(steps=[StepSpec(id="one", action="value", value=1)]))
    await worker.submit(record.id)  # injected XADD failure does not escape
    assert worker.transport_degraded
    await asyncio.sleep(0.18)
    await worker.stop()
    assert engine.get(record.id).status.value == "completed"
    assert stream.reconnects >= 1


class InitiallyDownStream(FakeStream):
    def __init__(self):
        super().__init__()
        self.up = False

    @property
    def configured(self):
        return True

    @property
    def available(self):
        return self.up

    async def connect(self):
        return self.up

    async def close(self):
        return None

    async def ensure_group(self, stream, group):
        if not self.up:
            raise RuntimeError("Redis unavailable")
        await super().ensure_group(stream, group)

    async def publish(self, stream, event):
        if not self.up:
            raise RuntimeError("Redis unavailable")
        return await super().publish(stream, event)


@pytest.mark.asyncio
async def test_configured_down_redis_uses_local_worker_until_transport_recovers(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    stream = InitiallyDownStream()
    worker = ExecutionWorker(engine, stream)
    await worker.start()
    record = engine.accept(EventRequest(steps=[StepSpec(id="one", action="value", value=1)]))
    await worker.submit(record.id)
    await asyncio.sleep(0.08)
    assert engine.get(record.id).status.value == "completed"
    assert worker.transport_degraded
    stream.up = True
    await asyncio.sleep(0.12)
    assert not worker.transport_degraded
    await worker.stop()


@pytest.mark.asyncio
async def test_restart_resumes_preexisting_queue_locally_while_redis_is_down(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    record = engine.accept(EventRequest(steps=[StepSpec(id="one", action="value", value=1)]))
    stream = InitiallyDownStream()
    worker = ExecutionWorker(engine, stream)
    await worker.start()
    await asyncio.sleep(0.06)
    assert engine.get(record.id).status.value == "completed"
    assert worker.transport_degraded
    assert not stream.up
    await worker.stop()