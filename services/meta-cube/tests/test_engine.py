import pytest

from meta_cube.engine import ExecutionEngine, IdempotencyConflict
from meta_cube.models import EventRequest, ExecutionStatus, StepSpec


def test_event_lifecycle_and_idempotency(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    event = EventRequest(event_id="event-1", payload={"x": 1}, idempotency_key="same")
    first = engine.submit(event)
    duplicate = engine.submit(event)
    assert first.status == ExecutionStatus.COMPLETED
    assert duplicate.id == first.id
    assert len(engine.list()) == 1


def test_bounded_retry_moves_to_dlq(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    record = engine.submit(EventRequest(steps=[StepSpec(id="broken", action="fail")], max_attempts=2))
    assert record.status == ExecutionStatus.DEAD_LETTER
    assert record.attempts["broken"] == 2
    assert engine.dlq()[0].execution_id == record.id
    queued = engine.retry(record.id)
    assert queued.status == ExecutionStatus.CREATED
    assert queued.attempts["broken"] == 0
    assert not engine.dlq()


def test_checkpoint_and_recovery_skips_done_steps(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    record = engine.submit(EventRequest(steps=[
        StepSpec(id="one", action="value", value=1),
        StepSpec(id="two", action="value", value=2, failures_before_success=1, depends_on=["one"]),
    ], max_attempts=1))
    assert record.status == ExecutionStatus.DEAD_LETTER
    assert [item.step_id for item in engine.checkpoints(record.id)] == ["one"]
    recovered = engine.recover(record.id)
    assert recovered.results["one"] == 1
    assert recovered.status == ExecutionStatus.COMPLETED


def test_dag_execution_preserves_dependencies(tmp_path):
    engine = ExecutionEngine(tmp_path / "state.json")
    result = engine.submit(EventRequest(payload={"source": "ok"}, steps=[
        StepSpec(id="a", action="value", value="a"),
        StepSpec(id="b", action="value", value="b"),
        StepSpec(id="join", depends_on=["a", "b"]),
    ]))
    assert result.status == ExecutionStatus.COMPLETED
    assert result.results["join"]["dependencies"] == {"a": "a", "b": "b"}


def test_manual_operation_replays_durable_winner_and_rejects_retargeting(tmp_path):
    path = tmp_path / "state.json"
    engine = ExecutionEngine(path)
    failed = engine.submit(EventRequest(
        steps=[StepSpec(id="broken", action="fail")], max_attempts=1,
    ))
    winner = engine.transition_operation(0, failed.id, "retry", "manual-key")
    assert winner.status == ExecutionStatus.CREATED

    # A fresh engine simulates a process restart and must return the original
    # operation response instead of attempting a second transition.
    replay = ExecutionEngine(path).transition_operation(0, failed.id, "retry", "manual-key")
    assert replay.model_dump() == winner.model_dump()
    with pytest.raises(IdempotencyConflict, match="different operation or execution"):
        ExecutionEngine(path).transition_operation(0, failed.id, "recover", "manual-key")