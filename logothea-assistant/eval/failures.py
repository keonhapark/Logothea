"""통과하지 못한 문항을 실패 유형으로 나눈다. 코드로만 판정한다(채점 결과는 보고서에 이미 있는 것을 쓴다).

한 문항이 여러 유형에 걸칠 수 있다. 유형은 고칠 곳(판정 규칙, 검색·도구, 생성 프롬프트)을 가리키도록 나눈다.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from eval.compare import item_passed

FAILURE_TYPES: dict[str, str] = {
    "error": "오류로 답을 받지 못함",
    "time_violation": "질문 시점 이후 자료를 근거로 씀",
    "wrong_refusal": "답할 질문을 거절함",
    "missed_refusal": "거절할 질문에 답함",
    "no_evidence_as_answered": "근거 없음 답인데 answered 로 판정됨",
    "answered_as_no_evidence": "답할 수 있는데 근거 없음으로 답함",
    "contradicted_point": "정답 요점과 반대되는 내용을 단정함",
    "point_missed_gold_not_cited": "요점 누락 — 정답 근거를 인용하지 못함(검색·근거 선택)",
    "point_missed_gold_cited": "요점 누락 — 정답 근거를 인용하고도 내용을 빠뜨림(생성)",
}


def classify_row(row: dict[str, Any], gold_sequences: list[int]) -> list[str]:
    if item_passed(row):
        return []
    if row.get("error"):
        return ["error"]
    types: list[str] = []
    if row.get("time_violations"):
        types.append("time_violation")
    expected, status = row.get("expected_status"), row.get("status")
    if expected != status:
        if status == "refused":
            types.append("wrong_refusal")
        elif expected == "refused":
            types.append("missed_refusal")
        elif expected == "no_evidence":
            types.append("no_evidence_as_answered")
        else:
            types.append("answered_as_no_evidence")
    judgment = row.get("judgment")
    if judgment:
        verdicts = [p["verdict"] for p in judgment["points"]]
        if "contradicted" in verdicts:
            types.append("contradicted_point")
        if "absent" in verdicts:
            cited = {int(c["ref"]) for c in row.get("citations", [])
                     if c.get("type") == "segment" and c.get("ref") is not None}
            types.append("point_missed_gold_cited" if cited & set(gold_sequences) else "point_missed_gold_not_cited")
    return types


def failure_table(reports: list[dict[str, Any]], gold: dict[str, list[int]]) -> dict[str, Any]:
    """유형별 건수(문항×회차)와 유형별 문항 목록."""
    counts: Counter[str] = Counter()
    items: dict[str, set[str]] = {}
    for report in reports:
        for row in report["items"]:
            for kind in classify_row(row, gold.get(row["id"], [])):
                counts[kind] += 1
                items.setdefault(kind, set()).add(row["id"])
    return {"runs": len(reports), "counts": {k: counts[k] for k in FAILURE_TYPES if counts[k]},
            "items": {k: sorted(items[k]) for k in FAILURE_TYPES if k in items}}
