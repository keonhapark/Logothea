from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from models.earnings_intelligence_models import EarningsIntelligenceRequest
from services.earnings_intelligence_service import EarningsIntelligenceService


@pytest.mark.asyncio
async def test_historical_intelligence_uses_cutoff_for_every_search():
    retriever = Mock()
    retriever.retrieve.return_value = [SimpleNamespace(published_at=2000), SimpleNamespace(published_at=0)]
    service = EarningsIntelligenceService(retriever)
    result = await service.analyze(EarningsIntelligenceRequest(
        ticker="WMT", event_text="Revenue increased by 4%.", as_of_epoch=1000,
    ))
    assert retriever.retrieve.call_count >= 2
    assert all(call.kwargs["chunk_timestamp"] == 1000 for call in retriever.retrieve.call_args_list)
    assert result.evidence_count == 0
    assert all(not check.evidence for check in result.fact_checks)
    assert all(not check.evidence for check in result.claim_diffs)


def test_cutoff_includes_exact_boundary_and_excludes_future_or_unknown():
    retriever = Mock()
    docs = [SimpleNamespace(published_at=999), SimpleNamespace(published_at=1000),
            SimpleNamespace(published_at=1001), SimpleNamespace(published_at=None)]
    retriever.retrieve.return_value = docs
    assert EarningsIntelligenceService(retriever)._retrieve_as_of(chunk_timestamp=1000) == docs[:2]


@pytest.mark.asyncio
async def test_legacy_request_without_cutoff_uses_wall_clock(monkeypatch):
    monkeypatch.setattr("services.earnings_intelligence_service.time.time", lambda: 4321)
    retriever = Mock()
    retriever.retrieve.return_value = []
    await EarningsIntelligenceService(retriever).analyze(EarningsIntelligenceRequest(
        ticker="WMT", event_text="Revenue increased by 4%.",
    ))
    assert all(call.kwargs["chunk_timestamp"] == 4321 for call in retriever.retrieve.call_args_list)
