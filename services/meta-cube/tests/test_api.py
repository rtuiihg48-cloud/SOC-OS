import time

from fastapi.testclient import TestClient

from meta_cube.api import create_app
from test_worker import InitiallyDownStream


def test_checkpoint_projection_is_per_completed_step(tmp_path):
    with TestClient(create_app(tmp_path / "state.json")) as client:
        accepted = client.post("/v1/events", json={
            "name": "linear", "payload": {"x": 1}, "steps": ["first", "second"], "maxRetries": 0,
        })
        assert accepted.status_code == 202
        execution_id = accepted.json()["id"]
        for _ in range(20):
            if client.get(f"/v1/executions/{execution_id}").json()["status"] == "succeeded":
                break
            time.sleep(0.01)
        rows = client.get("/v1/checkpoints", params={"executionId": execution_id}).json()
        assert len(rows) == 2
        assert rows[0]["executionId"] == execution_id
        assert rows[0]["completedSteps"] == ["first"]
        assert rows[0]["state"]["output"] == {"payload": {"x": 1}, "dependencies": {}}


def test_health_keeps_local_authority_and_exposes_worker_state(tmp_path):
    with TestClient(create_app(tmp_path / "state.json")) as client:
        client.app.state.redis.url = "redis://configured-but-down"
        client.app.state.worker.transport_degraded = True
        health = client.get("/healthz").json()
        assert health["persistence"] == "local"
        assert health["status"] == "degraded"
        assert health["worker"] == "idle"


def test_health_is_degraded_then_ok_for_recovering_redis_transport(tmp_path):
    stream = InitiallyDownStream()
    with TestClient(create_app(tmp_path / "state.json", redis_adapter=stream)) as client:
        accepted = client.post("/v1/events", json={
            "name": "fallback", "payload": {}, "steps": ["one"], "maxRetries": 0,
        })
        execution_id = accepted.json()["id"]
        time.sleep(0.08)
        assert client.get(f"/v1/executions/{execution_id}").json()["status"] == "succeeded"
        assert client.get("/healthz").json()["status"] == "degraded"
        stream.up = True
        time.sleep(0.12)
        assert client.get("/healthz").json()["status"] == "ok"