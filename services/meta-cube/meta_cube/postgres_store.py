from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Any, Iterator

from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


class PostgresStore:
    """PostgreSQL implementation of Store using short parameterized queries."""

    def __init__(self, database_url: str, min_size: int | None = None, max_size: int | None = None) -> None:
        self.database_url = database_url
        self.pool = ConnectionPool(
            conninfo=database_url,
            min_size=min_size or int(os.getenv("META_CUBE_PG_POOL_MIN", "1")),
            max_size=max_size or int(os.getenv("META_CUBE_PG_POOL_MAX", "5")),
            open=False,
        )
        self._local = threading.local()

    def open(self) -> None:
        self.pool.open(wait=True)
        with self.pool.connection() as conn:
            conn.execute("SELECT 1")

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def lock(self, scope: str) -> Iterator[None]:
        # Session-level advisory lock permits individual state writes to commit
        # before the next DAG step while keeping this execution exclusive.
        with self.pool.connection() as conn:
            conn.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", (scope,))
            conn.commit()
            self._local.conn = conn
            self._local.scope = scope
            try:
                yield
            finally:
                try:
                    conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (scope,))
                    conn.commit()
                finally:
                    self._local.conn = None
                    self._local.scope = None

    def _connection(self):
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            return conn, False
        return self.pool.connection(), True

    def read(self) -> dict[str, Any]:
        connection, owned = self._connection()
        if owned:
            with connection as conn:
                return self._read(conn)
        return self._read(connection)

    def _read(self, conn) -> dict[str, Any]:
        state: dict[str, Any] = {"executions": {}, "idempotency": {}, "checkpoints": {}, "dlq": {}}
        for row in conn.execute("SELECT id, idempotency_key, data FROM meta_cube_executions"):
            state["executions"][row[0]] = row[2]
            state["idempotency"][row[1]] = row[0]
        for row in conn.execute("SELECT id, execution_id, step_id, data FROM meta_cube_checkpoints"):
            state["checkpoints"].setdefault(row[1], {})[row[2]] = row[3]
        for row in conn.execute("SELECT id, data FROM meta_cube_dlq"):
            state["dlq"][row[0]] = row[1]
        return state

    def update(self, data: dict[str, Any]) -> None:
        connection, owned = self._connection()
        if owned:
            with connection as conn:
                self._update(conn, data)
                conn.commit()
        else:
            self._update(connection, data)
            connection.commit()

    def _update(self, conn, data: dict[str, Any]) -> None:
        scope = getattr(self._local, "scope", "")
        target_id = scope.removeprefix("execution:") if scope.startswith("execution:") else None
        records = (record for record in data["executions"].values()
                   if target_id is None or record["id"] == target_id)
        for record in records:
            conn.execute(
                """INSERT INTO meta_cube_executions
                   (id,idempotency_key,name,status,payload,steps,completed_steps,attempts,max_retries,error,created_at,updated_at,finished_at,data)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, completed_steps=EXCLUDED.completed_steps,
                   attempts=EXCLUDED.attempts,error=EXCLUDED.error,updated_at=EXCLUDED.updated_at,
                   finished_at=EXCLUDED.finished_at,data=EXCLUDED.data""",
                (record["id"], record["idempotency_key"], record["name"], record["status"], Jsonb(record["payload"]),
                 Jsonb([item["id"] for item in record["steps"]]), Jsonb(list(record["results"])), Jsonb(record["attempts"]),
                 record["max_attempts"] - 1, record["error"], record["created_at"], record["updated_at"],
                 record.get("finished_at"), Jsonb(record)),
            )
        checkpoint_sets = ((execution_id, checkpoints) for execution_id, checkpoints in data["checkpoints"].items()
                           if target_id is None or execution_id == target_id)
        for execution_id, checkpoints in checkpoint_sets:
            for step_id, checkpoint in checkpoints.items():
                conn.execute(
                    """INSERT INTO meta_cube_checkpoints (id,execution_id,step_id,created_at,data)
                       VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
                    (checkpoint["id"], execution_id, step_id, checkpoint["written_at"], Jsonb(checkpoint)),
                )
        letters = (item for item in data["dlq"].values()
                   if target_id is None or item["execution_id"] == target_id)
        for item in letters:
            conn.execute(
                """INSERT INTO meta_cube_dlq (id,execution_id,event_id,step_id,attempts,error,created_at,data)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
                (item["id"], item["execution_id"], item["event_id"], item["step_id"], item["attempts"],
                 item["error"], item["created_at"], Jsonb(item)),
            )

    def create_execution(self, record: dict[str, Any]) -> dict[str, Any]:
        """Atomic idempotent accept; conflict returns the winning record."""
        connection, owned = self._connection()
        if owned:
            with connection as conn:
                return self._create_execution(conn, record)
        return self._create_execution(connection, record)

    def _create_execution(self, conn, record: dict[str, Any]) -> dict[str, Any]:
        row = conn.execute(
                """INSERT INTO meta_cube_executions
                   (id,idempotency_key,name,status,payload,steps,completed_steps,attempts,max_retries,error,created_at,updated_at,finished_at,data)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (idempotency_key) DO NOTHING RETURNING data""",
                (record["id"], record["idempotency_key"], record["name"], record["status"], Jsonb(record["payload"]),
                 Jsonb([item["id"] for item in record["steps"]]), Jsonb([]), Jsonb({}), record["max_attempts"] - 1,
                 record["error"], record["created_at"], record["updated_at"], record.get("finished_at"), Jsonb(record)),
        ).fetchone()
        if row:
            conn.commit()
            return row[0]
        winner = conn.execute("SELECT data FROM meta_cube_executions WHERE idempotency_key=%s",
                              (record["idempotency_key"],)).fetchone()
        conn.commit()
        return winner[0]

    def persist_retry(self, record: dict[str, Any]) -> None:
        """Atomically remove stale dead letters and persist the retry state."""
        connection, owned = self._connection()
        try:
            if owned:
                with connection as conn:
                    self._persist_retry(conn, record)
            else:
                self._persist_retry(connection, record)
        except Exception:
            # DELETE and execution transition are one transaction; an update
            # error cannot leave a dead letter removed on its own.
            connection.rollback()
            raise

    def _persist_retry(self, conn, record: dict[str, Any]) -> None:
        conn.execute("DELETE FROM meta_cube_dlq WHERE execution_id=%s", (record["id"],))
        self._update(conn, {"executions": {record["id"]: record}, "checkpoints": {}, "dlq": {}})
        conn.commit()

    def delete_dlq_for_execution(self, execution_id: str) -> None:
        connection, owned = self._connection()
        if owned:
            with connection as conn:
                conn.execute("DELETE FROM meta_cube_dlq WHERE execution_id=%s", (execution_id,))
                conn.commit()
        else:
            connection.execute("DELETE FROM meta_cube_dlq WHERE execution_id=%s", (execution_id,))
            connection.commit()