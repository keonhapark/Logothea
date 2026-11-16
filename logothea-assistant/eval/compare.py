"""여러 보고서(JSON)의 핵심 지표를 모아 평균과 편차를 낸다. 파일을 쓰지 않는다."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Callable

METRICS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "status_accuracy": lambda s: s.get("status_accuracy"),
    "evidence_recall": lambda s: s.get("evidence_recall"),
    "numeric_citation_check_rate": lambda s: s.get("numeric_citation_check_rate"),
    "key_point_coverage": lambda s: (s.get("judge") or {}).get("key_point_coverage"),
    "citation_precision": lambda s: (s.get("judge") or {}).get("citation_precision"),
    "first_token_p50": lambda s: (s.get("latency_ms") or {}).get("first_token_p50"),
    "cost_per_question": lambda s: (s.get("cost_usd") or {}).get("per_question"),
}


def aggregate(summaries: list[dict[str, Any]]) -> dict[str, dict[str, float | None]]:
    """지표별 평균과 모표준편차. 값이 하나도 없으면 None."""
    result: dict[str, dict[str, float | None]] = {}
    for name, getter in METRICS.items():
        values = [float(v) for s in summaries if (v := getter(s)) is not None]
        if not values:
            result[name] = {"mean": None, "std": None}
            continue
        mean = sum(values) / len(values)
        std = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))
        result[name] = {"mean": mean, "std": std}
    return result


def item_passed(row: dict[str, Any]) -> bool:
    """문항 통과(주 지표): 오류 없이 기대 상태가 맞고, 시점 위반이 없고, 채점됐다면 모든 요점이 present 다.

    인용 정밀도는 통과 조건에 넣지 않고 따로 본다. 채점 없이 돌린 보고서는 상태·시점만으로 판정되므로
    채점 켠 보고서끼리만 비교한다.
    """
    if row.get("error") or row.get("status") != row.get("expected_status") or row.get("time_violations"):
        return False
    judgment = row.get("judgment")
    return not judgment or all(p["verdict"] == "present" for p in judgment["points"])


def pass_at_k(reports: list[dict[str, Any]]) -> dict[str, Any]:
    """모든 보고서에 공통으로 있는 문항에 대해 pass@1(회차 평균), pass@k(한 번이라도), pass^k(매번)."""
    runs = [{row["id"]: item_passed(row) for row in report["items"]} for report in reports]
    common = sorted(set.intersection(*(set(run) for run in runs))) if runs else []
    if not common:
        return {"items": 0, "k": len(runs), "pass_at_1": None, "pass_at_k": None, "pass_hat_k": None, "flaky": []}
    return {
        "items": len(common),
        "k": len(runs),
        "pass_at_1": sum(sum(run[i] for i in common) / len(common) for run in runs) / len(runs),
        "pass_at_k": sum(1 for i in common if any(run[i] for run in runs)) / len(common),
        "pass_hat_k": sum(1 for i in common if all(run[i] for run in runs)) / len(common),
        "flaky": [i for i in common if len({run[i] for run in runs}) > 1],
    }


def load_reports(paths: list[Path]) -> list[dict[str, Any]]:
    return [json.loads(Path(p).read_text(encoding="utf-8")) for p in paths]
