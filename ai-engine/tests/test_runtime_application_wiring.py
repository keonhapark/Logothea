"""Regression coverage for PR185 application startup and new local APIs."""
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

import main
from config import Settings


def build_app(monkeypatch, tmp_path, **overrides):
    settings = Settings(
        _env_file=None,
        company_intelligence_store_path=str(tmp_path / "companies.json"),
        live_session_store_path=str(tmp_path / "sessions"),
        redis_retry_spool_path=str(tmp_path / "retry.jsonl"),
        evidence_sync_enabled=False,
        **overrides,
    )
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    return main.create_app()


def test_runtime_settings_are_loaded_from_environment(monkeypatch):
    monkeypatch.setenv("EVIDENCE_SYNC_TICKERS", "wmt, nvda, ,aapl")
    monkeypatch.setenv("LIVE_SESSION_MAX_SESSIONS", "7")
    settings = Settings(_env_file=None)
    assert settings.evidence_sync_tickers_list == ["WMT", "NVDA", "AAPL"]
    assert settings.live_session_max_sessions == 7


def test_app_lifespan_starts_and_stops_scheduler(monkeypatch, tmp_path):
    app = build_app(monkeypatch, tmp_path)
    scheduler = app.state.evidence_ingestion_scheduler
    scheduler.start = AsyncMock()
    scheduler.stop = AsyncMock()
    with TestClient(app) as client:
        assert client.get("/v1/engine/company-intelligence/WMT").status_code == 200
        scheduler.start.assert_awaited_once()
        scheduler.stop.assert_not_awaited()
    scheduler.stop.assert_awaited_once()


def test_live_session_and_operations_routes_work_offline(monkeypatch, tmp_path):
    app = build_app(monkeypatch, tmp_path)
    with TestClient(app) as client:
        created = client.post("/v1/engine/live-sessions", json={"ticker": "WMT", "publish_final_signal": False})
        assert created.status_code == 201, created.text
        session_id = created.json()["session_id"]
        assert client.get(f"/v1/engine/live-sessions/{session_id}").status_code == 200
        assert client.get("/v1/engine/redis/retry/status").json()["pending"] == 0
        assert client.post("/v1/engine/redis/retry").status_code == 200
        assert client.post("/v1/engine/evidence/bootstrap-schema").json() == {
            "status": "ok", "evidence_schema_applied": False,
        }
    assert app.state.evidence_ingestion_scheduler._task is None
