import json

from eval.__main__ import main
from eval.dataset import EvalItem
from eval.review_sheet import agreement, build_sheet_rows, read_sheet, write_sheet


def item(item_id):
    return EvalItem(id=item_id, group="answerable", question=f"질문 {item_id}", as_of_sequence=10,
                    expected_status="answered", key_points=["요점0", "요점1"], gold_sequences=[1])


def row(item_id, judged=True):
    return {"id": item_id, "answer": "매출이 늘었습니다 [S1]. 비용도 줄었습니다 [S2].",
            "citations": [{"marker": "S1", "quote": "Sales grew"}, {"marker": "S2", "quote": "Costs fell"}],
            "judgment": {"points": [{"point_index": 0, "verdict": "present"}, {"point_index": 1, "verdict": "absent"}],
                         "citations": [{"marker": "S1", "supported": True}, {"marker": "S2", "supported": False}]}
            if judged else None}


def test_sheet_has_one_line_per_verdict_and_question_only_on_first_line():
    report = {"items": [row("a"), row("b", judged=False)]}
    rows = build_sheet_rows(report, {"a": item("a"), "b": item("b")})
    assert [(r["kind"], r["judge"]) for r in rows] == [("point", "present"), ("point", "absent"),
                                                       ("citation", "yes"), ("citation", "no")]
    assert rows[0]["question"] == "질문 a" and rows[1]["question"] == "" and rows[1]["answer"] == ""
    assert rows[1]["target"] == "요점1"
    assert "Costs fell" in rows[3]["target"] and "비용도 줄었습니다 [S2]." in rows[3]["target"]


def test_sheet_sample_is_capped_and_deterministic():
    report = {"items": [row(f"q{i:02}") for i in range(20)]}
    items = {f"q{i:02}": item(f"q{i:02}") for i in range(20)}
    first = build_sheet_rows(report, items, n=5, seed=1)
    assert len({r["item_id"] for r in first}) == 5
    assert first == build_sheet_rows(report, items, n=5, seed=1)


def test_agreement_counts_only_valid_filled_values(tmp_path):
    rows = build_sheet_rows({"items": [row("a")]}, {"a": item("a")})
    for r, human in zip(rows, ["present", "present", "O", "maybe"]):
        r["human"] = human
    path = tmp_path / "s.csv"
    write_sheet(path, rows)
    result = agreement(read_sheet(path))
    assert result["point"]["checked"] == 2 and result["point"]["agreed"] == 1
    assert result["point"]["disagreements"] == ["a: 채점기 absent / 사람 present"]
    assert result["citation"] == {"checked": 1, "agreed": 1, "rate": 1.0, "invalid": 1, "disagreements": []}


def test_sheet_and_agreement_commands(tmp_path, capsys):
    from eval.dataset import DATASET_PATH, load_dataset
    first = load_dataset(DATASET_PATH).items[0]
    report = tmp_path / "r.json"
    data = row(first.id)
    data["judgment"]["points"] = [{"point_index": i, "verdict": "present"} for i in range(len(first.key_points))]
    report.write_text(json.dumps({"summary": {}, "items": [data]}), encoding="utf-8")
    assert main(["sheet", str(report)]) == 0
    sheet = tmp_path / "r-review.csv"
    assert sheet.exists()
    assert main(["agreement", str(sheet)]) == 0
    assert "point: 검수 0건" in capsys.readouterr().out


def test_sheet_command_rejects_unjudged_report(tmp_path):
    report = tmp_path / "r.json"
    report.write_text(json.dumps({"summary": {}, "items": [row("x", judged=False)]}), encoding="utf-8")
    assert main(["sheet", str(report)]) == 1
