import os
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from meta_cube.engine import ExecutionEngine
from meta_cube.models import EventRequest, ExecutionStatus, StepSpec
from meta_cube.postgres_store import PostgresStore


class _SchemaResult:
    def __init__(self, rows):
        self.rows = rows

    def __iter__(self):
        return iter(self.rows)


class _SchemaConnection:
    def __init__(self, tables: list[str]):
        self.tables = tables

    def execute(self, *_args, **_kwargs):
        return _SchemaResult([(table,) for table in self.tables])


def test_authoritative_schema_check_rejects_missing_migration_tables():
    with pytest.raises(RuntimeError, match="authoritative migration.*meta_cube_dlq"):
        PostgresStore._verify_authoritative_schema(
            _SchemaConnection(["meta_cube_executions", "meta_cube_checkpoints", "meta_cube_operation_idempotency"])
        )


def _migration_exists(store: PostgresStore) -> bool:
    with store.pool.connection() as connection:
        return all(connection.execute("SELECT to_regclass(%s)", (name,)).fetchone()[0] is not None
                   for name in ("meta_cube_executions", "meta_cube_operation_idempotency"))


@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="requires DATABASE_URL")
def test_postgres_instances_are_idempotent_and_visible():
    """Uses only unique test IDs and removes only rows created by this test."""
    url = os.environ["DATABASE_URL"]
    first, second = PostgresStore(url, min_size=1, max_size=2), PostgresStore(url, min_size=1, max_size=2)
    created_ids: list[str] = []
    try:
        first.open()
        second.open()
        if not _migration_exists(first):
            pytest.skip("META-CUBE migration is not installed on configured PostgreSQL")

        token = f"pytest-{uuid4()}"
        event = EventRequest(
            name=token, event_id=token, idempotency_key=token,
            steps=[StepSpec(id="done", action="value", value={"token": token})],
        )
        engine_a, engine_b = ExecutionEngine(first), ExecutionEngine(second)
        barrier = threading.Barrier(2)

        def accept(engine: ExecutionEngine):
            barrier.wait()
            return engine.accept(event)

        with ThreadPoolExecutor(max_workers=2) as executor:
            accepted = list(executor.map(accept, (engine_a, engine_b)))
        assert len({record.id for record in accepted}) == 1
        execution_id = accepted[0].id
        created_ids.append(execution_id)

        completed = engine_a.execute(execution_id)
        assert completed.status == ExecutionStatus.COMPLETED
        # A separate store/engine sees durable state after an instance restart.
        assert engine_b.get(execution_id).status == ExecutionStatus.COMPLETED
        checkpoints_before = engine_b.checkpoints(execution_id)
        assert len(checkpoints_before) == 1
        assert engine_b.execute(execution_id).status == ExecutionStatus.COMPLETED
        assert [item.id for item in engine_b.checkpoints(execution_id)] == [item.id for item in checkpoints_before]

        failed = engine_a.submit(EventRequest(
            name=f"{token}-failure", event_id=f"{token}-failure", idempotency_key=f"{token}-failure",
            steps=[StepSpec(id="broken", action="fail")], max_attempts=1,
        ))
        created_ids.append(failed.id)
        assert failed.status == ExecutionStatus.DEAD_LETTER
        assert any(item.execution_id == failed.id for item in engine_b.dlq())
        barrier = threading.Barrier(2)

        def retry(engine: ExecutionEngine):
            barrier.wait()
            return engine.transition_operation(0, failed.id, "retry", f"{token}-manual-retry")

        with ThreadPoolExecutor(max_workers=2) as executor:
            retried = list(executor.map(retry, (engine_a, engine_b)))
        assert {record.status for record in retried} == {ExecutionStatus.CREATED}
        # The response is captured at the winning transition, so it remains
        # stable even when read through another store/process afterwards.
        assert engine_b.transition_operation(0, failed.id, "retry", f"{token}-manual-retry").model_dump() == retried[0].model_dump()
        assert not any(item.execution_id == failed.id for item in engine_a.dlq())
    finally:
        # FK cascade deletes checkpoints and DLQ rows. Parameterized per-ID
        # deletes ensure unrelated development records are never touched.
        if first.pool.closed is False:
            for execution_id in created_ids:
                with first.pool.connection() as connection:
                    connection.execute("DELETE FROM meta_cube_executions WHERE id=%s", (execution_id,))
                    connection.commit()
        first.close()
        second.close()


@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="requires DATABASE_URL")
def test_postgres_pool_one_accept_and_atomic_retry_rollback():
    """A scoped accept must not checkout a second connection from pool size one."""
    url = os.environ["DATABASE_URL"]
    store = PostgresStore(url, min_size=1, max_size=1)
    created_ids: list[str] = []
    try:
        store.open()
        if not _migration_exists(store):
            pytest.skip("META-CUBE migration is not installed on configured PostgreSQL")
        engine = ExecutionEngine(store)
        token = f"pytest-pool-one-{uuid4()}"
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(engine.accept, EventRequest(
                name=token, event_id=token, idempotency_key=token,
                steps=[StepSpec(id="done", action="value", value=1)],
            ))
            accepted = future.result(timeout=2)
        created_ids.append(accepted.id)

        # Distinct keys proceed concurrently up to pool capacity rather than
        # starving on a nested checkout during their advisory scopes.
        capacity_store = PostgresStore(url, min_size=2, max_size=2)
        capacity_store.open()
        try:
            engines = [ExecutionEngine(capacity_store), ExecutionEngine(capacity_store)]
            barrier = threading.Barrier(2)

            def distinct(index: int):
                marker = f"{token}-distinct-{index}"
                barrier.wait()
                return engines[index].accept(EventRequest(
                    name=marker, event_id=marker, idempotency_key=marker,
                    steps=[StepSpec(id="done", action="value", value=index)],
                ))

            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(distinct, index) for index in range(2)]
                rows = [future.result(timeout=2) for future in futures]
            created_ids.extend(row.id for row in rows)
        finally:
            capacity_store.close()

        failed = engine.submit(EventRequest(
            name=f"{token}-dead", event_id=f"{token}-dead", idempotency_key=f"{token}-dead",
            steps=[StepSpec(id="broken", action="fail")], max_attempts=1,
        ))
        created_ids.append(failed.id)
        original_update = store._update

        def injected_failure(*_args, **_kwargs):
            raise RuntimeError("injected execution update failure")

        store._update = injected_failure
        with pytest.raises(RuntimeError, match="injected"):
            engine.retry(failed.id)
        store._update = original_update
        # The delete and execution update rolled back as a unit.
        assert engine.get(failed.id).status == ExecutionStatus.DEAD_LETTER
        assert any(item.execution_id == failed.id for item in engine.dlq())
    finally:
        if store.pool.closed is False:
            for execution_id in created_ids:
                with store.pool.connection() as connection:
                    connection.execute("DELETE FROM meta_cube_executions WHERE id=%s", (execution_id,))
                    connection.commit()
        store.close()