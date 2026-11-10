"""Backend market_data.symbol remains accepted without changing canonical output."""

from models.request_models import AnalyzeRequest, MarketData


def test_backend_symbol_survives_nested_analysis_request():
    request = AnalyzeRequest.model_validate({
        "ticker": "WMT",
        "prompt": "Revenue grew.",
        "market_data": {"symbol": "WMT", "current_price": 100.0},
    })
    assert request.market_data.ticker == "WMT"
    assert request.market_data.current_price == 100.0
    dumped = request.model_dump(by_alias=True)["market_data"]
    assert dumped["ticker"] == "WMT"
    assert "symbol" not in dumped


def test_canonical_ticker_takes_precedence_over_legacy_symbol():
    market_data = MarketData.model_validate({"ticker": "NVDA", "symbol": "WMT"})
    assert market_data.ticker == "NVDA"


def test_explicit_null_ticker_is_not_overridden_by_symbol():
    assert MarketData.model_validate({"ticker": None, "symbol": "WMT"}).ticker is None


def test_absent_ticker_keeps_existing_default():
    assert MarketData().ticker is None
