"""P0.1 — DICOM data-integrity regressions (multi-file/series/SOP/multi-frame/order/merge)."""

from __future__ import annotations

from pathlib import Path

from pydicom.uid import generate_uid

from app.dicom.fixtures import (
    brain_mri_multisequence_files,
    brain_mri_study_files,
    colliding_sop_volume_files,
    multiframe_mr_file,
    unordered_ipp_stack_files,
)
from app.dicom.ingest import ingest_dicom_files
from app.imaging.pixel_ops import parse_image_position
from app.imaging.series_selection import select_series_for_modality
from app.models.dicom_study_merge import merge_study_into
from app.models.study_inventory import build_study_inventory
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, DicomValidationCode, Modality, Species
from app.schemas.model_input import ModelInputFrameRef, ModelInputSeriesRef
from app.storage.quarantine import QuarantineStore


def test_ingest_keeps_all_slices_for_10_and_33() -> None:
    for n in (10, 33):
        result = ingest_dicom_files(brain_mri_study_files(n))
        assert result.blocked is False
        assert result.study is not None
        assert result.study.instance_count == n
        assert result.study.series_count == 1
        sops = [i.sop_instance_uid for s in result.study.series for i in s.instances]
        assert len(sops) == len(set(sops)) == n


def test_multiseries_ingest_preserves_both_sequences() -> None:
    files = brain_mri_multisequence_files(t2_instances=3, flair_instances=2)
    result = ingest_dicom_files(files)
    assert result.blocked is False
    assert result.study is not None
    assert result.study.series_count == 2
    assert result.study.instance_count == 5
    counts = sorted(len(s.instances) for s in result.study.series)
    assert counts == [2, 3]


def test_colliding_sop_volume_kept_sorted() -> None:
    files = colliding_sop_volume_files(10)
    # Shuffle upload order by reversing mid chunk.
    files = files[5:] + files[:5]
    result = ingest_dicom_files(files)
    assert result.blocked is False
    assert result.study is not None
    assert result.study.instance_count == 10
    dups = [i for i in result.issues if i.code == DicomValidationCode.DUPLICATE_SOP]
    assert len(dups) == 9  # first kept as-is; 9 disambiguated
    assert all("disambiguated" in i.message.lower() for i in dups)
    series = result.study.series[0]
    inst_nos = [i.instance_number for i in series.instances]
    assert inst_nos == list(range(1, 11))
    zs = []
    for inst in series.instances:
        ipp = parse_image_position(inst.image_position_patient)
        assert ipp is not None
        zs.append(ipp[2])
    assert zs == sorted(zs)
    sops = [i.sop_instance_uid for i in series.instances]
    assert len(set(sops)) == 10


def test_true_byte_duplicate_dropped_once() -> None:
    files = colliding_sop_volume_files(3)
    files.append(("dup_first.dcm", files[0][1]))
    result = ingest_dicom_files(files)
    assert result.study is not None
    assert result.study.instance_count == 3
    dropped = [
        i
        for i in result.issues
        if i.code == DicomValidationCode.DUPLICATE_SOP and "dropped" in i.message.lower()
    ]
    assert len(dropped) == 1


def test_unordered_ipp_study_tree_sorted_by_position() -> None:
    result = ingest_dicom_files(unordered_ipp_stack_files(5))
    assert result.study is not None
    instances = result.study.series[0].instances
    assert [i.instance_number for i in instances] == [1, 2, 3, 4, 5]
    zs = []
    for i in instances:
        ipp = parse_image_position(i.image_position_patient)
        assert ipp is not None
        zs.append(ipp[2])
    assert zs == sorted(zs)


def test_series_selection_orders_by_ipp() -> None:
    frames = [
        ModelInputFrameRef(
            sop_instance_uid=f"sop-{n}",
            series_instance_uid="ser-1",
            instance_number=n,
            image_position_patient=f"0\\0\\{float(n - 1) * 3.0}",
            has_pixel_data=True,
        )
        for n in (3, 1, 2)
    ]
    series = [
        ModelInputSeriesRef(
            series_instance_uid="ser-1",
            series_description="T2",
            modality=Modality.MR,
            frames=frames,
        )
    ]
    sel = select_series_for_modality(series, Modality.MR)
    assert [f.instance_number for f in sel.frames] == [1, 2, 3]


def test_merge_keeps_distinct_colliding_sop_slices() -> None:
    shared = generate_uid()
    series_uid = generate_uid()
    study_uid = generate_uid()

    def _study(inst_no: int, z: float, filename: str) -> DicomStudyMeta:
        return DicomStudyMeta(
            study_instance_uid=study_uid,
            series=[
                DicomSeriesMeta(
                    series_instance_uid=series_uid,
                    series_description="T2",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid=shared,
                            instance_number=inst_no,
                            filename=filename,
                            rows=8,
                            columns=8,
                            image_position_patient=f"0\\0\\{z}",
                            has_pixel_data=True,
                        )
                    ],
                )
            ],
        )

    base = _study(1, 0.0, "a_001.dcm")
    extra = _study(2, 2.0, "b_002.dcm")
    merged = merge_study_into(base, extra, ingest_id="ing-2")
    assert merged.instance_count == 2
    sops = [i.sop_instance_uid for s in merged.series for i in s.instances]
    assert len(set(sops)) == 2
    # Re-merge true duplicate of slice 1 — still 2.
    again = merge_study_into(merged, _study(1, 0.0, "a_001_copy.dcm"), ingest_id="ing-3")
    assert again.instance_count == 2


def test_merge_union_multiseries_no_loss() -> None:
    full = ingest_dicom_files(brain_mri_multisequence_files(t2_instances=4, flair_instances=3))
    assert full.study is not None
    # series sorted by series_number: T2=1 then FLAIR=2
    t2, flair = full.study.series[0], full.study.series[1]
    assert len(t2.instances) == 4 and len(flair.instances) == 3
    base = full.study.model_copy(
        update={"series": [t2.model_copy(update={"instances": t2.instances[:2]})]}
    )
    extra = full.study.model_copy(
        update={
            "series": [
                t2.model_copy(update={"instances": t2.instances[2:]}),
                flair,
            ]
        }
    )
    merged = merge_study_into(base, extra, ingest_id="ing-extra")
    assert merged.series_count == 2
    assert merged.instance_count == 7


def test_inventory_expands_number_of_frames(tmp_path: Path) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "dicom-mf"
    name, data = multiframe_mr_file(frames=4)
    refs = store.store_files(ingest, [(name, data)], content_kinds=["dicom"])
    ref = refs[0]
    case = CaseRecord(
        case_id="case-mf",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        dicom_ingest_id=ingest,
        quarantine_dir=str(root / ingest),
        dicom_study=DicomStudyMeta(
            study_instance_uid=generate_uid(),
            series=[
                DicomSeriesMeta(
                    series_instance_uid=generate_uid(),
                    series_description="MF T2",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid=generate_uid(),
                            instance_number=1,
                            filename=name,
                            has_pixel_data=True,
                            quarantine_relative_path=ref.relative_path,
                        )
                    ],
                )
            ],
        ),
    )
    inv = build_study_inventory(case, store)
    assert len(inv.dicom_files) == 1
    assert inv.frames_detected == 4
    assert [f.frame_index for f in inv.frames] == [0, 1, 2, 3]


def test_inventory_counts_match_ingest_for_large_stack(tmp_path: Path) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "dicom-33"
    files = brain_mri_study_files(33)
    refs = store.store_files(ingest, files, content_kinds=["dicom"] * len(files))
    result = ingest_dicom_files(files)
    assert result.study is not None
    # Attach quarantine paths in filename order matching store_files.
    by_name = {r.original_filename: r for r in refs}
    series = result.study.series[0]
    tagged = [
        inst.model_copy(
            update={"quarantine_relative_path": by_name[inst.filename or ""].relative_path}
        )
        for inst in series.instances
        if inst.filename in by_name
    ]
    study = result.study.model_copy(
        update={"series": [series.model_copy(update={"instances": tagged})]}
    )
    case = CaseRecord(
        case_id="case-33",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        dicom_ingest_id=ingest,
        quarantine_dir=str(root / ingest),
        dicom_study=study,
    )
    inv = build_study_inventory(case, store)
    assert inv.frames_detected == 33
    assert len(inv.dicom_files) == 33
