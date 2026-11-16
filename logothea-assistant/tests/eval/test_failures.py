import json

from eval.__main__ import main
from eval.failures import classify_row, failure_table


def row(**overrides):
    base = {"id": "a", "status": "answered", "expected_status": "answered", "error": None, "time_violations": [],
            "citations": [{"type": "segment", "ref": "5", "marker": "S5"}],
            "judgment": {"points": [{"point_index": 0, "verdict": "present"}], "citations": []}}
    base.update(overrides)
    return base


def judged(*verdicts):
    return {"points": [{"point_index": i, "verdict": v} for i, v in enumerate(verdicts)], "citations": []}


def test_passing_row_has_no_failure():
    assert classify_row(row(), [5]) == []


def test_status_failures():
    assert classify_row(row(error={"code": "timeout"}), [5]) == ["error"]
    assert classify_row(row(status="refused"), [5]) == ["wrong_refusal"]
    assert classify_row(row(expected_status="refused", judgment=None), []) == ["missed_refusal"]
    assert classify_row(row(expected_status="no_evidence", judgment=None), []) == ["no_evidence_as_answered"]
    assert classify_row(row(status="no_evidence", judgment=None), []) == ["answered_as_no_evidence"]


def test_point_failures_split_by_gold_citation():
    assert classify_row(row(judgment=judged("present", "absent")), [5]) == ["point_missed_gold_cited"]
    assert classify_row(row(judgment=judged("absent")), [9]) == ["point_missed_gold_not_cited"]
    assert classify_row(row(judgment=judged("contradicted", "absent"), time_violations=["S9"]), [9]) == [
        "time_violation", "contradicted_point", "point_missed_gold_not_cited"]


def test_failure_table_counts_runs_and_items():
    reports = [{"items": [row(status="refused"), row(id="b")]}, {"items": [row(status="refused")]}]
    table = failure_table(reports, {"a": [5], "b": [5]})
    assert table == {"runs": 2, "counts": {"wrong_refusal": 2}, "items": {"wrong_refusal": ["a"]}}


def test_failures_command(tmp_path, capsys):
    path = tmp_path / "r.json"
    path.write_text(json.dumps({"summary": {}, "items": [row(status="refused")]}), encoding="utf-8")
    assert main(["failures", str(path)]) == 0
    assert "wrong_refusal 1건" in capsys.readouterr().out
