"""채점기 사람 검수: 보고서에서 채점된 문항을 뽑아 판정 한 줄씩 CSV 로 만들고, 채운 시트로 일치율을 낸다.

한 줄이 채점기 판정 하나(요점 하나 또는 인용 표시 하나)다. 사람은 `human` 칸만 채운다.
- 요점: present / contradicted / absent
- 인용: yes / no (뒷받침하면 yes)
"""

from __future__ import annotations

import csv
import random
from pathlib import Path
from typing import Any

from assistant.citations import find_markers, split_sentences
from eval.dataset import EvalItem

COLUMNS = ["item_id", "question", "answer", "kind", "target", "judge", "human", "memo"]
POINT_VALUES = {"present", "contradicted", "absent"}
CITATION_ALIASES = {"yes": "yes", "y": "yes", "o": "yes", "true": "yes",
                    "no": "no", "n": "no", "x": "no", "false": "no"}


def build_sheet_rows(report: dict[str, Any], items: dict[str, EvalItem], n: int = 10, seed: int = 0) -> list[dict[str, str]]:
    judged = [row for row in report["items"] if row.get("judgment") and row["id"] in items]
    picked = sorted(random.Random(seed).sample(judged, min(n, len(judged))), key=lambda row: row["id"])
    rows: list[dict[str, str]] = []
    for row in picked:
        item = items[row["id"]]
        first = True
        for verdict in row["judgment"]["points"]:
            rows.append(_row(item, row, first, "point", item.key_points[verdict["point_index"]], verdict["verdict"]))
            first = False
        for verdict in row["judgment"]["citations"]:
            rows.append(_row(item, row, first, "citation", _citation_target(row, verdict["marker"]),
                             "yes" if verdict["supported"] else "no"))
            first = False
    return rows


def _row(item: EvalItem, row: dict[str, Any], first: bool, kind: str, target: str, judge: str) -> dict[str, str]:
    # 질문과 답은 문항의 첫 줄에만 적어 시트를 읽기 쉽게 한다.
    return {"item_id": item.id, "question": item.question if first else "", "answer": row.get("answer", "") if first else "",
            "kind": kind, "target": target, "judge": judge, "human": "", "memo": ""}


def _citation_target(row: dict[str, Any], marker: str) -> str:
    quote = next((c.get("quote") or "" for c in row.get("citations", []) if c.get("marker") == marker), "")
    sentences = [s for s in split_sentences(row.get("answer", "")) if marker in find_markers(s)]
    return f"[{marker}] 원문: {quote}\n쓰인 문장: {' / '.join(sentences)}"


def write_sheet(path: Path, rows: list[dict[str, str]]) -> None:
    # utf-8-sig: 엑셀·넘버스에서 한글이 깨지지 않게 BOM 을 붙인다.
    with Path(path).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def read_sheet(path: Path) -> list[dict[str, str]]:
    with Path(path).open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _normalize(kind: str, value: str) -> str | None:
    value = value.strip().lower()
    if kind == "point":
        return value if value in POINT_VALUES else None
    return CITATION_ALIASES.get(value)


def agreement(rows: list[dict[str, str]]) -> dict[str, Any]:
    """종류별 일치율. 비었거나 알 수 없는 값은 세지 않고 따로 센다."""
    result: dict[str, Any] = {}
    for kind in ("point", "citation"):
        filled = [(r["judge"], human) for r in rows if r["kind"] == kind and (human := _normalize(kind, r.get("human", "")))]
        invalid = sum(1 for r in rows if r["kind"] == kind and r.get("human", "").strip() and not _normalize(kind, r["human"]))
        agreed = sum(1 for judge, human in filled if judge == human)
        result[kind] = {"checked": len(filled), "agreed": agreed, "rate": agreed / len(filled) if filled else None,
                        "invalid": invalid,
                        "disagreements": [f"{r['item_id']}: 채점기 {r['judge']} / 사람 {r['human'].strip()}"
                                          for r in rows if r["kind"] == kind and (h := _normalize(kind, r.get("human", "")))
                                          and h != r["judge"]]}
    return result
