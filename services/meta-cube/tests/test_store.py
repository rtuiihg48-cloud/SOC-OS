from meta_cube.store import FileStore, Store


def test_file_store_satisfies_authoritative_store_contract(tmp_path):
    store = FileStore(tmp_path / "state.json")
    assert isinstance(store, Store)
    with store.lock("execution:test"):
        state = store.read()
        state["executions"]["test"] = {"id": "test"}
        store.update(state)
    assert store.read()["executions"]["test"]["id"] == "test"