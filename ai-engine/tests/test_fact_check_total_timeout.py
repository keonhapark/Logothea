"""A fact-check request has one budget, including queue wait and all stages."""
import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from config import Settings
from models.live_fact_check_models import LiveFactCheckSentenceRequest
from services.live_news_fact_check_service import LiveNewsFactCheckService, _ClaimExtractionResult


def request(sequence, *, end=False):
    return LiveFactCheckSentenceRequest(
        ticker="WMT", sentence="Revenue grew 5%.", sentence_sequence=sequence,
        sentence_timestamp=1_900_000_000 + sequence, is_session_end=end,
    )


def service(budget):
    return LiveNewsFactCheckService(settings=Settings(
        _env_file=None, fact_check_total_timeout_seconds=budget,
        fact_check_extraction_timeout_seconds=2,
        fact_check_retrieval_timeout_seconds=2,
        fact_check_llm_timeout_seconds=2,
    ))


@pytest.mark.parametrize("budget", [0, -1, 46, float("inf"), float("nan")])
def test_invalid_total_budget_is_rejected(budget):
    with pytest.raises(ValidationError):
        service(budget)


@pytest.mark.asyncio
async def test_cumulative_stage_time_discards_consumed_batch_and_releases_lock(monkeypatch):
    subject = service(0.35)
    visited = []
    cancelled = asyncio.Event()

    async def extract(**kwargs):
        visited.append("extract")
        await asyncio.sleep(0.1)
        return _ClaimExtractionResult()

    async def retrieve(**kwargs):
        visited.append("retrieve")
        await asyncio.sleep(0.1)
        return [SimpleNamespace(accepted=[object()])], False

    async def verify(**kwargs):
        visited.append("verify")
        try:
            await asyncio.sleep(1)
        finally:
            cancelled.set()
        return {}, []

    monkeypatch.setattr(subject, "_extract_claims", extract)
    monkeypatch.setattr(subject, "_validate_claims", lambda **kwargs: ([object()], 0))
    monkeypatch.setattr(subject, "_retrieve_claim_evidence", retrieve)
    monkeypatch.setattr(subject, "_verify_claims", verify)
    await subject.submit_sentence(request(0))
    await subject.submit_sentence(request(1))
    started = asyncio.get_running_loop().time()
    result = await subject.submit_sentence(request(2))
    elapsed = asyncio.get_running_loop().time() - started
    assert visited == ["extract", "retrieve", "verify"]
    assert 0.3 <= elapsed < 0.9
    assert cancelled.is_set()
    assert result.status.value == "DISCARDED"
    assert result.warnings == ["fact_check_total_timeout"]
    assert (result.batch_start_sequence, result.batch_end_sequence) == (0, 2)
    assert result.claims == []
    assert not subject._ticker_locks["WMT"].locked()
    assert (await subject.submit_sentence(request(2))).status.value == "REJECTED"
    assert (await subject.submit_sentence(request(3))).buffered_count == 1


@pytest.mark.asyncio
async def test_lock_wait_timeout_does_not_consume_sentence_or_release_another_owner_lock():
    subject = service(0.03)
    await subject.submit_sentence(request(0))
    lock = await subject._lock_for("WMT")
    await lock.acquire()
    try:
        result = await subject.submit_sentence(request(1))
        assert lock.locked()
        assert result.status.value == "REJECTED"
        assert result.warnings == ["fact_check_total_timeout"]
        assert result.batch_start_sequence is None
        assert result.buffered_count == 1
    finally:
        lock.release()
    retried = await subject.submit_sentence(request(1))
    assert retried.status.value == "BUFFERING"
    assert retried.buffered_count == 2


@pytest.mark.asyncio
async def test_external_cancellation_propagates_and_releases_lock(monkeypatch):
    subject = service(1)
    started = asyncio.Event()
    stopped = asyncio.Event()

    async def extract(**kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(subject, "_extract_claims", extract)
    await subject.submit_sentence(request(0))
    await subject.submit_sentence(request(1))
    task = asyncio.create_task(subject.submit_sentence(request(2, end=True)))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert stopped.is_set()
    assert not subject._ticker_locks["WMT"].locked()
    assert "WMT" not in subject._buffers
    assert (await subject.submit_sentence(request(0))).buffered_count == 1
