import time
import base64
import hashlib
import hmac
import json

from fastapi.testclient import TestClient

from meta_cube.api import create_app
from test_worker import InitiallyDownStream


def headers(capability: str, idempotency_key: str | None = None) -> dict[str, str]:
    context = {"tenantId": 1, "principalType": "USER", "principalId": "test",
               "capability": capability, "correlationId": "test", "idempotencyKey": idempotency_key}
    encoded = base64.urlsafe_b64encode(json.dumps(context, separators=(",", ":")).encode()).decode().rstrip("=")
    return {"x-meta-cube-context": encoded,
            "x-meta-cube-signature": hmac.new(b"test-internal-secret", encoded.encode(), hashlib.sha256).hexdigest()}


def test_direct_requests_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setenv("META_CUBE_INTERNAL_SECRET", "test-internal-secret")
    with TestClient(create_app(tmp_path / "state.json")) as client:
        assert client.get("/v1/executions").status_code == 401


def test_tenant_filter_and_submit_idempotency_conflict(tmp_path, monkeypatch):
    monkeypatch.setenv("META_CUBE_INTERNAL_SECRET", "test-internal-secret")
    body = {"name": "one", "payload": {"x": 1}, "steps": ["first"], "idempotencyKey": "key"}
    with TestClient(create_app(tmp_path / "state.json")) as client:
        assert client.post("/v1/events", json=body, headers=headers("execution:submit", "key")).status_code == 202
        changed = {**body, "payload": {"x": 2}}
        assert client.post("/v1/events", json=changed, headers=headers("execution:submit", "key")).status_code == 409
        other = headers("execution:read")
        raw = json.loads(base64.urlsafe_b64decode(other["x-meta-cube-context"] + "=="))
        raw["tenantId"] = 2
        encoded = base64.urlsafe_b64encode(json.dumps(raw, separators=(",", ":")).encode()).decode().rstrip("=")
        other["x-meta-cube-context"] = encoded
        other["x-meta-cube-signature"] = hmac.new(b"test-internal-secret", encoded.encode(), hashlib.sha256).hexdigest()
        assert client.get("/v1/executions", headers=other).json() == []


def test_checkpoint_projection_is_per_completed_step(tmp_path, monkeypatch):
    monkeypatch.setenv("META_CUBE_INTERNAL_SECRET", "test-internal-secret")
    with TestClient(create_app(tmp_path / "state.json")) as client:
        accepted = client.post("/v1/events", json={
            "name": "linear", "payload": {"x": 1}, "steps": ["first", "second"], "maxRetries": 0,
            "idempotencyKey": "checkpoint",
        }, headers=headers("execution:submit", "checkpoint"))
        assert accepted.status_code == 202
        execution_id = accepted.json()["id"]
        for _ in range(20):
            if client.get(f"/v1/executions/{execution_id}", headers=headers("execution:read")).json()["status"] == "succeeded":
                break
            time.sleep(0.01)
        rows = client.get("/v1/checkpoints", params={"executionId": execution_id}, headers=headers("execution:read")).json()
        assert len(rows) == 2
        assert rows[0]["executionId"] == execution_id
        assert rows[0]["completedSteps"] == ["first"]
        assert rows[0]["state"]["output"] == {"payload": {"x": 1}, "dependencies": {}}


def test_health_keeps_local_authority_and_exposes_worker_state(tmp_path, monkeypatch):
    monkeypatch.setenv("META_CUBE_INTERNAL_SECRET", "test-internal-secret")
    with TestClient(create_app(tmp_path / "state.json")) as client:
        client.app.state.redis.url = "redis://configured-but-down"
        client.app.state.worker.transport_degraded = True
        health = client.get("/healthz", headers=headers("execution:health")).json()
        assert health["persistence"] == "file"
        assert health["status"] == "degraded"
        assert health["worker"] == "idle"


def test_health_is_degraded_then_ok_for_recovering_redis_transport(tmp_path, monkeypatch):
    monkeypatch.setenv("META_CUBE_INTERNAL_SECRET", "test-internal-secret")
    stream = InitiallyDownStream()
    with TestClient(create_app(tmp_path / "state.json", redis_adapter=stream)) as client:
        accepted = client.post("/v1/events", json={
            "name": "fallback", "payload": {}, "steps": ["one"], "maxRetries": 0, "idempotencyKey": "fallback",
        }, headers=headers("execution:submit", "fallback"))
        execution_id = accepted.json()["id"]
        time.sleep(0.08)
        assert client.get(f"/v1/executions/{execution_id}", headers=headers("execution:read")).json()["status"] == "succeeded"
        assert client.get("/healthz", headers=headers("execution:health")).json()["status"] == "degraded"
        stream.up = True
        time.sleep(0.12)
        assert client.get("/healthz", headers=headers("execution:health")).json()["status"] == "ok"