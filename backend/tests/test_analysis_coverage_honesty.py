"""P0.2 — inventory vs decode vs visual analysis must stay distinct."""

from __future__ import annotations

from app.schemas.analysis_coverage import AnalysisCoverage, SeriesCoverage


def test_metadata_only_never_claims_visual_complete() -> None:
    cov = AnalysisCoverage(
        frames_detected=33,
        frames_detected_non_localizer=33,
        frames_planned=0,
        frames_decoded=0,
        frames_visually_analyzed=0,
        series_total=1,
        series=[
            SeriesCoverage(
                series_instance_uid="s1",
                frames_detected=33,
                frames_planned=0,
                frames_decoded=0,
                frames_visually_analyzed=0,
            )
        ],
    ).finalize()
    assert cov.is_metadata_only is True
    assert cov.analysis_scope == "none"
    assert cov.analysis_complete is False
    assert cov.frames_skipped == 33
    lines = "\n".join(cov.summary_lines_tr())
    assert "tespit 33" in lines
    assert "decode 0" in lines
    assert "görsel analiz 0" in lines
    assert "görsel analiz yapılmadı" in lines
    assert lines.split("\n")[0].startswith("Kapsam: YOK")
    assert "tam görsel analiz değil" in lines.split("\n")[0]


def test_decode_without_visual_is_not_complete() -> None:
    cov = AnalysisCoverage(
        frames_detected=10,
        frames_detected_non_localizer=10,
        frames_planned=10,
        frames_decode_attempted=10,
        frames_decoded=10,
        frames_visually_analyzed=0,
    ).finalize()
    assert cov.analysis_scope == "none"
    assert cov.analysis_complete is False
    assert cov.is_metadata_only is True
    assert cov.frames_decoded == 10


def test_partial_and_full_use_visual_only() -> None:
    partial = AnalysisCoverage(
        frames_detected=100,
        frames_detected_non_localizer=100,
        frames_planned=20,
        frames_decode_attempted=20,
        frames_decoded=20,
        frames_visually_analyzed=20,
    ).finalize()
    assert partial.analysis_scope == "partial"
    assert partial.analysis_complete is False
    assert partial.frames_skipped == 80

    full = AnalysisCoverage(
        frames_detected=8,
        frames_detected_non_localizer=8,
        frames_planned=8,
        frames_decode_attempted=8,
        frames_decoded=8,
        frames_visually_analyzed=8,
    ).finalize()
    assert full.analysis_scope == "full"
    assert full.analysis_complete is True
    assert full.is_metadata_only is False


def test_finalize_clamps_visual_to_decoded_when_tracked() -> None:
    cov = AnalysisCoverage(
        frames_detected=5,
        frames_detected_non_localizer=5,
        frames_decode_attempted=5,
        frames_decoded=2,
        frames_visually_analyzed=9,  # dishonest input
    ).finalize()
    assert cov.frames_visually_analyzed == 2
    assert cov.analysis_scope == "partial"
    assert cov.analysis_complete is False


def test_to_metadata_exposes_three_counters() -> None:
    cov = AnalysisCoverage(
        frames_detected=12,
        frames_detected_non_localizer=10,
        frames_decode_attempted=6,
        frames_decoded=5,
        frames_visually_analyzed=4,
        include_localizers=False,
    ).finalize()
    meta = cov.to_metadata()
    assert meta["frames_detected"] == "12"
    assert meta["frames_decoded"] == "5"
    assert meta["frames_visually_analyzed"] == "4"
    assert meta["images_sent"] == "4"
    assert meta["analysis_scope"] == "partial"
    assert meta["analysis_complete"] == "false"
    assert meta["metadata_only"] == "false"


def test_summary_never_collapses_counters() -> None:
    cov = AnalysisCoverage(
        dicom_files_total=3,
        series_total=2,
        frames_detected=40,
        frames_detected_non_localizer=40,
        frames_decoded=12,
        frames_visually_analyzed=8,
        series=[
            SeriesCoverage(series_instance_uid="a", frames_detected=20, frames_decoded=6, frames_visually_analyzed=4),
            SeriesCoverage(series_instance_uid="b", frames_detected=20, frames_decoded=6, frames_visually_analyzed=4),
        ],
    ).finalize()
    line = cov.summary_lines_tr()[1]
    assert "tespit 40" in line
    assert "decode 12" in line
    assert "görsel analiz 8" in line
    # Must not look like a single "40 analyzed" claim.
    assert "tespit 40 · decode 12 · görsel analiz 8" in line
