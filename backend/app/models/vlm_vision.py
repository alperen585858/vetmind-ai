"""OpenAI-compatible multimodal VLM Vision adapter (Gemini / GPT-4o / etc.).

Sends real DICOM/document image bytes to a chat-completions endpoint that accepts
``image_url`` parts. Not a trained veterinary model — outputs are decision-support
only and may be wrong. Failures raise ImagingAdapterError (no silent mock fallback).

Each finding is grounded to an IMG-# catalog entry (series / SOP / instance / frame,
optional bbox) so a radiologist can verify the claim on the same pixels.
"""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import httpx
from pydicom import dcmread
from pydicom.errors import InvalidDicomError

from app.http_policy import vision_http_policy
from app.imaging.display_png import (
    dicom_bytes_to_png,
    evenly_sample,
    is_localizer_label,
    maybe_image_bytes,
    select_frame_indices,
)
from app.llm.chat_providers import GEMINI_DEFAULT_BASE_URL, OPENAI_DEFAULT_BASE_URL
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.model_input_builder import require_model_input
from app.models.study_inventory import InventoryFrame, build_study_inventory
from app.models.vlm_batch_planner import plan_visual_analysis
from app.models.vlm_result_cache import VlmBatchResultCache, batch_cache_key
from app.models.ontology import canonicalize_finding_code, is_known_finding_code, is_technique_code
from app.models.vlm_grounding import (
    SentFrame,
    catalog_metadata,
    evidence_for_frame,
    format_image_catalog,
    harden_finding_fields,
    resolve_source_frame,
    study_inventory_metadata,
)
from app.schemas.analysis_coverage import AnalysisCoverage, SeriesCoverage
from app.schemas.case import CaseRecord
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings, StudyInfo
from app.storage.quarantine import QuarantineStore

_VALID_FINDING_STATUS = {s.value for s in FindingStatus}
_VLM_MAX_EDGE = 1024

# Merge keeps the *more uncertain* status (never upgrade certainty across batches).
_STATUS_UNCERTAINTY_RANK = {
    FindingStatus.SUSPECTED: 0,
    FindingStatus.POSSIBLE: 1,
    FindingStatus.NOT_ASSESSED: 2,
    FindingStatus.UNCERTAIN: 3,
}


def _normalize_vlm_code(raw: str) -> tuple[str, bool]:
    """Return (canonical_code, was_unknown). Unknown free-form → VLM-UNSPECIFIED."""
    code = canonicalize_finding_code(raw)
    if is_known_finding_code(code) or is_technique_code(code):
        return code, False
    # Keep structured clinical-ish tokens not yet in ontology; reject free prose codes.
    upper = (raw or "").strip().upper().replace("_", "-")
    if re.search(
        r"(MASS|LESION|TUMOR|TUMOUR|HEMOR|EDEMA|INFARCT|HERNIA|FRACTURE|NODULE|CYST|"
        r"VENTRICLE|HYDROCEPHAL|PARENCHYM|IVDD|MENINGIOMA)",
        upper,
    ):
        return canonicalize_finding_code(raw) if raw.strip() else "VLM-UNSPECIFIED", False
    return "VLM-UNSPECIFIED", True


def _dedupe_findings(findings: list[Finding]) -> list[Finding]:
    """Merge duplicate code+location across batches; keep evidence refs.

    Technique codes (e.g. IMAGE-QUALITY) collapse to a single entry regardless of
    location. Status merge never upgrades certainty.
    """
    by_key: dict[tuple[str, str], Finding] = {}
    order: list[tuple[str, str]] = []
    for f in findings:
        code_key = f.finding_code.strip().upper()
        loc_key = "" if is_technique_code(f.finding_code) else (f.anatomical_location or "").strip().lower()
        key = (code_key, loc_key)
        if key not in by_key:
            by_key[key] = f
            order.append(key)
            continue
        prev = by_key[key]
        refs = list(prev.evidence_references) + [
            r for r in f.evidence_references if r.evidence_id not in {x.evidence_id for x in prev.evidence_references}
        ]
        desc = prev.description if len(prev.description) >= len(f.description) else f.description
        prev_rank = _STATUS_UNCERTAINTY_RANK.get(prev.finding_status, 0)
        new_rank = _STATUS_UNCERTAINTY_RANK.get(f.finding_status, 0)
        status = f.finding_status if new_rank > prev_rank else prev.finding_status
        note = prev.uncertainty_note or f.uncertainty_note
        if new_rank > prev_rank and f.uncertainty_note:
            note = f.uncertainty_note
        by_key[key] = prev.model_copy(
            update={
                "description": desc,
                "evidence_references": refs[:8],
                "finding_status": status,
                "uncertainty_note": note,
            }
        )
    return [by_key[k] for k in order]

_SYSTEM_PROMPT = """Sen veteriner teleradyoloji için yardımcı bir görüntü analiz asistanısın.
Klinik tanı koymazsın; uzman radyolog incelemesi zorunludur. Genel amaçlı bir VLM'sin —
veteriner radyolojide klinik olarak doğrulanmış değilsin.

Yalnızca JSON döndür. Şema:
{
  "execution_status": "success" | "partial" | "failed",
  "warnings": ["string"],
  "findings": [
    {
      "finding_code": "SHORT_CODE",
      "description": "Türkçe, somut, yalnızca piksellerde görünen",
      "anatomical_location": "kısa konum",
      "finding_status": "suspected" | "possible" | "uncertain" | "not_assessed",
      "uncertainty_note": "neden emin değilsin",
      "model_confidence": 0.0,
      "source_image_index": 1,
      "bbox_norm": [0.0, 0.0, 1.0, 1.0]
    }
  ]
}

ZORUNLU kurallar:
1) Her bulguda source_image_index ZORUNLU (IMAGE CATALOG'daki IMG-n numarası).
2) İlk madde teknik/görüntü kalitesi (IMAGE-QUALITY). Teknik sınırları patoloji sanma.
3) Yalnızca o IMG'de görünen anatomiyi yaz. Desteklenmeyen lezyon/kitle/kanama/ödem/tanı UYDURMA.
4) Emin değilsen finding_status=uncertain ve uncertainty_note yaz; uydurma iddia yazma.
5) MR: IMAGE CATALOG'da sequence_known=no ise hiper/hipointensiteyi patoloji gibi yorumlama —
   yalnızca görünür yapıyı tarif et veya belirsiz sinyal notu düş.
6) bbox_norm isteğe bağlı; odak bölge varsa 0–1 normalize [x_min,y_min,x_max,y_max] ver.
7) "Normal" / "patoloji yok" deme. Kesin tanı yazma. Uydurma DICOM UID yazma.
8) İngilizce sistem etiketleri / execution_status / pipeline jargonunu description'a yazma.
9) Görüntü yetersizse teknik maddede söyle; boş findings[] yasak, uydurma lezyon da yasak."""


@dataclass(frozen=True)
class _ImageCandidate:
    rel: str
    filename: str
    series_description: str | None
    sop_instance_uid: str | None
    series_instance_uid: str | None
    instance_number: int | None
    is_localizer: bool


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ImagingAdapterError("VLM returned empty content.")
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        data = json.loads(fence.group(1))
        if isinstance(data, dict):
            return data
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        data = json.loads(raw[start : end + 1])
        if isinstance(data, dict):
            return data
    raise ImagingAdapterError("VLM response was not valid JSON.")


def _mime_for(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _dicom_frame_count(data: bytes) -> int:
    try:
        ds = dcmread(BytesIO(data), force=True, stop_before_pixels=True)
    except (InvalidDicomError, Exception):
        return 1
    n = int(getattr(ds, "NumberOfFrames", 1) or 1)
    return max(1, n)


def _looks_like_dicom(name: str, data: bytes) -> bool:
    lower = (name or "").lower()
    if lower.endswith((".dcm", ".dicom")):
        return True
    return data[:132].find(b"DICM") >= 0


def _png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 24:
        return None
    import struct

    w, h = struct.unpack(">II", data[16:24])
    if w <= 0 or h <= 0:
        return None
    return int(w), int(h)


class OpenAiCompatibleVlmVisionModel:
    """Vision adapter that POSTs study images to an OpenAI-compatible multimodal chat API."""

    def __init__(
        self,
        *,
        model_id: str,
        chat_model_id: str,
        base_url: str,
        api_key: str | None,
        quarantine: QuarantineStore,
        timeout_s: float = 120.0,
        version: str = "0.1.0-vlm",
        max_images: int = 6,
        max_total_frames: int | None = None,
        include_localizers: bool = False,
        language: str = "tr",
        cache_root: Path | str | None = None,
    ) -> None:
        self.model_id = model_id
        self.version = version
        self._chat_model_id = chat_model_id
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._quarantine = quarantine
        self._timeout_s = float(timeout_s)
        self._max_images = max(1, min(int(max_images), 12))
        # Total visual budget across batches (default = at least one full batch).
        total = int(max_total_frames) if max_total_frames is not None else max(self._max_images, 64)
        self._max_total_frames = max(self._max_images, min(total, 1000))
        self._include_localizers = bool(include_localizers)
        self._language = (language or "tr").strip().lower() or "tr"
        self._last_inventory: dict[str, str] = {}
        # Optional: orchestrator sets this to stream batch progress onto AnalysisJob.
        self.progress_callback: Callable[[dict[str, Any]], None] | None = None
        cache_path = Path(cache_root) if cache_root else (Path(quarantine.root) / "_vlm_batch_cache")
        self._batch_cache = VlmBatchResultCache(cache_path)

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        """Stage A inventory → Stage B batched visual analysis → Stage C merge."""
        require_model_input(case)
        inventory = build_study_inventory(case, self._quarantine)
        self._last_inventory = study_inventory_metadata(
            candidate_count=len({f.quarantine_rel for f in inventory.frames}),
            localizer_candidates=sum(1 for f in inventory.frames if f.is_localizer),
            non_localizer_candidates=sum(1 for f in inventory.frames if not f.is_localizer),
            dicom_instance_count=len(inventory.dicom_files),
        )
        if not inventory.frames:
            raise ImagingAdapterError(
                "VLM Vision: no decodable image frames in quarantine for this case."
                + (
                    f" Skipped: {len(inventory.skipped)} undecodable/unsupported path(s)."
                    if inventory.skipped
                    else ""
                )
            )

        plan = plan_visual_analysis(
            inventory,
            max_total_frames=self._max_total_frames,
            per_batch_images=self._max_images,
            include_localizers=self._include_localizers,
        )
        if not plan.batches:
            raise ImagingAdapterError(
                "VLM Vision: inventory found frames but visual plan is empty."
            )

        coverage = plan.coverage
        all_findings: list[Finding] = []
        all_warnings: list[str] = []
        analyzed_keys: set[tuple] = set()
        series_analyzed_counts: dict[str, int] = {}
        series_decoded_counts: dict[str, int] = {}
        decode_attempted = 0
        decode_ok = 0
        batch_ok = 0
        batch_fail = 0
        cache_hits = 0
        last_mapped: StructuredFindings | None = None
        last_parsed: dict[str, Any] = {}
        all_sent: list[SentFrame] = []

        def _emit_progress(*, batch_i: int, analyzed_n: int) -> None:
            cb = self.progress_callback
            if cb is None:
                return
            series_done = sum(1 for n in series_analyzed_counts.values() if n > 0)
            target = (
                coverage.frames_detected
                if coverage.include_localizers
                else coverage.frames_detected_non_localizer
            )
            scope = "partial" if analyzed_n < target else ("full" if analyzed_n > 0 else "none")
            if analyzed_n <= 0:
                scope = "none"
            detail = (
                f"Görüntü analizi · parti {batch_i + 1}/{len(plan.batches)} · "
                f"tespit {target} · decode {decode_ok} · görsel {analyzed_n} · "
                f"seri {series_done}/{coverage.series_total}"
            )
            try:
                cb(
                    {
                        "vision_batch_index": batch_i,
                        "vision_batch_total": len(plan.batches),
                        "vision_frames_detected": target,
                        "vision_frames_decoded": decode_ok,
                        "vision_frames_analyzed": analyzed_n,
                        "vision_series_total": coverage.series_total,
                        "vision_series_done": series_done,
                        "vision_analysis_scope": scope,
                        "vision_detail": detail,
                    }
                )
            except Exception:
                return

        _emit_progress(batch_i=0, analyzed_n=0)

        for batch_i, batch_frames in enumerate(plan.batches):
            decode_attempted += len(batch_frames)
            sent = self._decode_inventory_batch(batch_frames)
            decode_ok += len(sent)
            for fr in sent:
                sk = fr.series_instance_uid or ""
                series_decoded_counts[sk] = series_decoded_counts.get(sk, 0) + 1
            if not sent:
                batch_fail += 1
                all_warnings.append(f"Batch {batch_i + 1}/{len(plan.batches)}: decode produced 0 PNGs.")
                _emit_progress(batch_i=batch_i, analyzed_n=len(analyzed_keys))
                continue

            frame_keys = [
                f"{s.sop_instance_uid or s.quarantine_rel}#f{s.frame_index}" for s in sent
            ]
            cache_key = batch_cache_key(
                case_id=case.case_id,
                chat_model_id=self._chat_model_id,
                frame_keys=frame_keys,
            )
            cached = self._batch_cache.get(cache_key)
            try:
                if cached is not None:
                    parsed = cached
                    cache_hits += 1
                else:
                    parsed = self._call_vlm(
                        case, sent, insist=False, batch_index=batch_i, batch_total=len(plan.batches)
                    )
                    self._batch_cache.put(cache_key, parsed)
                mapped = self._map_response(case, parsed, sent=sent, batch_index=batch_i)
                if not mapped.findings:
                    parsed = self._call_vlm(
                        case, sent, insist=True, batch_index=batch_i, batch_total=len(plan.batches)
                    )
                    self._batch_cache.put(cache_key, parsed)
                    mapped = self._map_response(case, parsed, sent=sent, batch_index=batch_i)
                last_parsed = parsed
                last_mapped = mapped
                batch_ok += 1
            except ImagingAdapterError as exc:
                batch_fail += 1
                all_warnings.append(f"Batch {batch_i + 1}/{len(plan.batches)} failed: {exc}")
                # One retry for transient failures
                try:
                    time.sleep(1.0)
                    parsed = self._call_vlm(
                        case, sent, insist=False, batch_index=batch_i, batch_total=len(plan.batches)
                    )
                    self._batch_cache.put(cache_key, parsed)
                    mapped = self._map_response(case, parsed, sent=sent, batch_index=batch_i)
                    last_parsed = parsed
                    last_mapped = mapped
                    batch_ok += 1
                    all_warnings.append(f"Batch {batch_i + 1} succeeded on retry.")
                except ImagingAdapterError as exc2:
                    all_warnings.append(f"Batch {batch_i + 1} retry failed: {exc2}")
                    _emit_progress(batch_i=batch_i, analyzed_n=len(analyzed_keys))
                    continue

            all_findings.extend(mapped.findings)
            all_warnings.extend(mapped.warnings)
            all_sent.extend(sent)
            for fr in sent:
                analyzed_keys.add(
                    (
                        fr.quarantine_rel or fr.sop_instance_uid or "",
                        fr.frame_index,
                        fr.sop_instance_uid or "",
                    )
                )
                sk = fr.series_instance_uid or ""
                series_analyzed_counts[sk] = series_analyzed_counts.get(sk, 0) + 1
            _emit_progress(batch_i=batch_i, analyzed_n=len(analyzed_keys))

        synthesized_empty = False
        if not all_findings and last_mapped is not None and all_sent:
            synth = self._synthesize_observations(
                case, last_mapped, sent=all_sent[: self._max_images], parsed=last_parsed
            )
            all_findings = list(synth.findings)
            all_warnings.extend(synth.warnings)
            synthesized_empty = True

        if not all_findings and batch_ok == 0:
            raise ImagingAdapterError(
                "; ".join(all_warnings) or "VLM Vision: all batches failed."
            )

        merged_findings = _dedupe_findings(all_findings)

        # Update series decode + visually-analyzed counts (kept distinct).
        new_series: list[SeriesCoverage] = []
        for sc in coverage.series:
            uid = sc.series_instance_uid or ""
            n_vis = series_analyzed_counts.get(uid, 0) if uid else 0
            n_dec = series_decoded_counts.get(uid, 0) if uid else 0
            new_series.append(
                sc.model_copy(
                    update={
                        "frames_decoded": n_dec,
                        "frames_visually_analyzed": n_vis,
                        "analyzed": n_vis > 0,
                    }
                )
            )
        visual_n = len(analyzed_keys) if analyzed_keys else len(all_sent)
        coverage = coverage.model_copy(
            update={
                "frames_decode_attempted": decode_attempted,
                "frames_decoded": decode_ok,
                "frames_visually_analyzed": visual_n,
                "batches_succeeded": batch_ok,
                "batches_failed": batch_fail,
                "series": new_series,
            }
        ).finalize()

        if coverage.is_metadata_only:
            all_warnings.append(
                "Kapsam: yalnızca metadata/envanter; görsel analiz yapılmadı "
                f"(tespit={coverage.frames_detected}, decode={coverage.frames_decoded}, görsel=0)."
            )
        elif coverage.analysis_scope == "partial":
            all_warnings.append(
                f"KISMİ görsel analiz: {coverage.frames_visually_analyzed}/"
                f"{coverage.inventory_target} "
                f"kare VLM'e gönderildi (tespit={coverage.frames_detected}, "
                f"decode={coverage.frames_decoded}, bütçe={coverage.total_frame_budget}). "
                "Tam analiz iddiası yoktur."
            )
        elif coverage.analysis_scope == "full":
            all_warnings.append(
                f"Kapsam: tespit edilen hedef karelerin tamamı görsel olarak gönderildi "
                f"(görsel={coverage.frames_visually_analyzed}, decode={coverage.frames_decoded})."
            )
        if inventory.skipped:
            all_warnings.append(
                f"{len(inventory.skipped)} dosya görüntü olarak çözülemedi "
                f"(metadata envanterinde skipped_files)."
            )

        # Drop false single-slice claims when multi-frame visual analysis actually ran.
        # Per-batch VLM text often describes "this PNG" as a single slice even though
        # the study inventory sent many frames across batches.
        if coverage.frames_visually_analyzed > 1:
            _single_re = re.compile(
                r"tek\s+bir\s+kesit|single\s+slice|only\s+one\s+(slice|image|frame)",
                re.IGNORECASE,
            )
            all_warnings = [w for w in all_warnings if not _single_re.search(w or "")]
            cleaned: list[Finding] = []
            for f in merged_findings:
                desc = f.description or ""
                if _single_re.search(desc):
                    cleaned.append(
                        f.model_copy(
                            update={
                                "description": _single_re.sub(
                                    f"{coverage.frames_visually_analyzed} kesitlik seri örneği",
                                    desc,
                                )
                            }
                        )
                    )
                else:
                    cleaned.append(f)
            merged_findings = cleaned

        meta = {
            "adapter": "openai_compatible_vlm",
            "chat_model_id": self._chat_model_id,
            "timeout_s": str(self._timeout_s),
            **self._last_inventory,
            **catalog_metadata(all_sent[:48]),
            **coverage.to_metadata(),
        }
        if synthesized_empty:
            meta["empty_findings_synthesized"] = "true"
        if cache_hits:
            meta["vlm_batch_cache_hits"] = str(cache_hits)
        status = ModelExecutionStatus.SUCCESS
        if batch_fail and batch_ok:
            status = ModelExecutionStatus.PARTIAL
        elif coverage.analysis_scope == "partial":
            status = ModelExecutionStatus.PARTIAL
        elif not merged_findings:
            status = ModelExecutionStatus.PARTIAL

        return StructuredFindings(
            case_id=case.case_id,
            study=StudyInfo(
                study_id=case.case_id,
                dicom_available=case.dicom_study is not None,
                metadata_only=False,
            ),
            species=case.species,
            modality=case.modality,
            anatomical_region=case.anatomical_region,
            source_model_id=self.model_id,
            source_model_version=self.version,
            source_kind=SourceKind.REAL,
            execution_status=status,
            findings=merged_findings,
            warnings=list(dict.fromkeys(all_warnings)),
            review_required=True,
            no_findings_returned=len(merged_findings) == 0,
            absences_not_confirmed=True,
            contributing_model_ids=[self.model_id],
            contributing_source_kinds=[SourceKind.REAL],
            processing_metadata=meta,
            analysis_coverage=coverage,
        )

    def _decode_inventory_batch(self, frames: list[InventoryFrame]) -> list[SentFrame]:
        sent: list[SentFrame] = []
        # Cache file bytes within a batch to avoid re-reading multi-frame SOPs.
        file_cache: dict[str, bytes] = {}
        for i, inv in enumerate(frames):
            data = file_cache.get(inv.quarantine_rel)
            if data is None:
                try:
                    _name, data = self._quarantine.read_file(inv.quarantine_rel)
                except Exception:
                    continue
                file_cache[inv.quarantine_rel] = data
            if inv.is_raster:
                img = maybe_image_bytes(inv.filename, data, max_edge=_VLM_MAX_EDGE)
                if img is None:
                    continue
                size = _png_size(img)
                sent.append(
                    SentFrame(
                        index=i + 1,
                        png=img,
                        sop_instance_uid=inv.sop_instance_uid,
                        series_instance_uid=inv.series_instance_uid,
                        instance_number=inv.instance_number,
                        frame_index=inv.frame_index,
                        series_description=inv.series_description,
                        is_localizer=inv.is_localizer,
                        width=size[0] if size else None,
                        height=size[1] if size else None,
                        quarantine_rel=inv.quarantine_rel,
                        series_number=inv.series_number,
                    )
                )
                continue
            result = dicom_bytes_to_png(
                data, frame_index=inv.frame_index, max_edge=_VLM_MAX_EDGE, as_rgb=True
            )
            if result is None:
                continue
            sent.append(
                SentFrame(
                    index=i + 1,
                    png=result.png_bytes,
                    sop_instance_uid=inv.sop_instance_uid,
                    series_instance_uid=inv.series_instance_uid,
                    instance_number=inv.instance_number,
                    frame_index=result.frame_index,
                    series_description=inv.series_description,
                    is_localizer=inv.is_localizer,
                    width=result.width,
                    height=result.height,
                    native_width=result.native_width,
                    native_height=result.native_height,
                    quarantine_rel=inv.quarantine_rel,
                    series_number=inv.series_number,
                )
            )
        return sent

    def _call_vlm(
        self,
        case: CaseRecord,
        sent: list[SentFrame],
        *,
        insist: bool,
        batch_index: int = 0,
        batch_total: int = 1,
    ) -> dict[str, Any]:
        content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": self._user_text(
                    case,
                    sent=sent,
                    insist=insist,
                    batch_index=batch_index,
                    batch_total=batch_total,
                ),
            }
        ]
        for fr in sent:
            b64 = base64.b64encode(fr.png).decode("ascii")
            mime = _mime_for(fr.png)
            # Tiny text label before each image so the model can bind IMG-n.
            content.append({"type": "text", "text": f"[IMG-{fr.index}]"})
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                }
            )

        payload: dict[str, Any] = {
            "model": self._chat_model_id,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            "temperature": 0.15,
            "response_format": {"type": "json_object"},
        }
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        policy = vision_http_policy(self._timeout_s)
        url = f"{self._base_url}/chat/completions"
        response: httpx.Response | None = None
        last_http_error: Exception | None = None
        for attempt in range(3):
            try:
                with httpx.Client(timeout=policy.timeout_s) as client:
                    response = client.post(url, json=payload, headers=headers)
            except httpx.TimeoutException as exc:
                raise ImagingAdapterError(
                    f"VLM Vision timed out after {self._timeout_s}s."
                ) from exc
            except httpx.HTTPError as exc:
                last_http_error = exc
                if attempt >= 2:
                    raise ImagingAdapterError(f"VLM Vision HTTP error: {exc}") from exc
                continue
            if response.status_code in {429, 503} and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            break
        if response is None:
            raise ImagingAdapterError(f"VLM Vision HTTP error: {last_http_error}")

        if response.status_code >= 400:
            detail = (response.text or "")[:400]
            raise ImagingAdapterError(
                f"VLM Vision HTTP {response.status_code}: {detail}"
            )

        try:
            body = response.json()
        except json.JSONDecodeError as exc:
            raise ImagingAdapterError("VLM Vision returned non-JSON HTTP body.") from exc

        try:
            text = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ImagingAdapterError(
                "VLM Vision response missing choices[0].message.content."
            ) from exc
        if isinstance(text, list):
            text = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part) for part in text
            )
        return _extract_json_object(str(text))

    def _user_text(
        self,
        case: CaseRecord,
        *,
        sent: list[SentFrame],
        insist: bool = False,
        batch_index: int = 0,
        batch_total: int = 1,
    ) -> str:
        history = (case.clinical_history or "").strip()
        lang = "Turkish" if self._language.startswith("tr") else "English"
        insist_line = (
            "\nPREVIOUS REPLY WAS INVALID because findings=[] was empty. "
            "Return technical notes + visible anatomy only, each with source_image_index. "
            "Do NOT invent lesions."
            if insist
            else ""
        )
        inv = self._last_inventory
        inventory_line = (
            f"Study inventory: dicom_files={inv.get('study_dicom_instances') or 'n/a'}; "
            f"frame_candidates={inv.get('vlm_candidate_files') or 'n/a'} "
            f"(non-localizer={inv.get('vlm_non_localizer_candidates') or '?'}, "
            f"localizer={inv.get('vlm_localizer_candidates') or '?'}); "
            f"visual_budget_total={self._max_total_frames}; "
            f"batch={batch_index + 1}/{batch_total}; attached_in_this_batch={len(sent)} "
            f"(per_batch_cap={self._max_images}).\n"
            "This batch is only part of the study unless batch_total=1. "
            "Do not claim you reviewed frames that are not in THIS IMAGE CATALOG.\n"
        )
        return (
            f"Species: {case.species.value}\n"
            f"Modality: {case.modality.value}\n"
            f"Anatomical region: {case.anatomical_region.value}\n"
            f"Clinical history: {history or '(none)'}\n"
            f"{inventory_line}"
            f"{format_image_catalog(sent)}\n"
            f"Write finding descriptions in {lang}.\n"
            "Every finding MUST set source_image_index to an IMG-n above.\n"
            "1) IMAGE-QUALITY on a real IMG\n"
            "2) Visible anatomy / only pixel-supported changes\n"
            "No unsupported lesions. No pathology from unknown MR sequence signal."
            f"{insist_line}"
        )

    def _gather_candidates(self, case: CaseRecord) -> list[_ImageCandidate]:
        by_rel: dict[str, _ImageCandidate] = {}

        def _put(
            rel: str | None,
            *,
            filename: str = "",
            series_description: str | None = None,
            sop: str | None = None,
            series_uid: str | None = None,
            instance_number: int | None = None,
        ) -> None:
            if not rel or rel in by_rel:
                return
            is_loc = is_localizer_label(series_description, filename)
            by_rel[rel] = _ImageCandidate(
                rel=rel,
                filename=filename,
                series_description=series_description,
                sop_instance_uid=sop,
                series_instance_uid=series_uid,
                instance_number=instance_number,
                is_localizer=is_loc,
            )

        model_input = case.model_input
        if model_input is not None:
            for series in model_input.series:
                desc = series.series_description
                for fr in series.frames:
                    if fr.quarantine_relative_path:
                        _put(
                            fr.quarantine_relative_path,
                            filename=fr.filename or "",
                            series_description=desc,
                            sop=fr.sop_instance_uid,
                            series_uid=fr.series_instance_uid or series.series_instance_uid,
                            instance_number=fr.instance_number,
                        )

        if case.dicom_study is not None:
            for ser in case.dicom_study.series:
                desc = ser.series_description
                for inst in ser.instances:
                    _put(
                        inst.quarantine_relative_path,
                        filename=inst.filename or "",
                        series_description=desc,
                        sop=getattr(inst, "sop_instance_uid", None),
                        series_uid=getattr(ser, "series_instance_uid", None),
                        instance_number=getattr(inst, "instance_number", None),
                    )

        if case.document_context is not None:
            for doc in case.document_context.documents:
                _put(
                    doc.quarantine_relative_path,
                    filename=Path(doc.quarantine_relative_path).name,
                )

        return list(by_rel.values())

    def _prioritize_candidates(self, candidates: list[_ImageCandidate]) -> list[_ImageCandidate]:
        non_loc = [c for c in candidates if not c.is_localizer]
        loc = [c for c in candidates if c.is_localizer]
        primary = non_loc or loc
        return evenly_sample(primary, self._max_images)

    def _expand_candidate(self, cand: _ImageCandidate, remaining: int) -> list[dict[str, Any]]:
        """Return partial frame dicts (png + dicom locus); indices assigned later."""
        if remaining <= 0:
            return []
        try:
            name, data = self._quarantine.read_file(cand.rel)
        except Exception:
            return []
        filename = cand.filename or name
        base = {
            "sop_instance_uid": cand.sop_instance_uid,
            "series_instance_uid": cand.series_instance_uid,
            "instance_number": cand.instance_number,
            "series_description": cand.series_description,
            "is_localizer": cand.is_localizer,
            "quarantine_rel": cand.rel,
        }

        if _looks_like_dicom(filename, data) or (
            data[:8] != b"\x89PNG\r\n\x1a\n" and data[:2] != b"\xff\xd8"
        ):
            n_frames = _dicom_frame_count(data)
            frame_budget = min(remaining, 3 if n_frames > 1 else 1)
            indices = select_frame_indices(n_frames, max_frames=frame_budget)
            out: list[dict[str, Any]] = []
            for idx in indices:
                if len(out) >= remaining:
                    break
                result = dicom_bytes_to_png(data, frame_index=idx, max_edge=_VLM_MAX_EDGE, as_rgb=True)
                if result is None:
                    continue
                out.append(
                    {
                        **base,
                        "png": result.png_bytes,
                        "frame_index": result.frame_index,
                        "width": result.width,
                        "height": result.height,
                    }
                )
            if out:
                return out

        img = maybe_image_bytes(filename, data, max_edge=_VLM_MAX_EDGE)
        if img is None:
            return []
        size = _png_size(img)
        return [
            {
                **base,
                "png": img,
                "frame_index": 0,
                "width": size[0] if size else None,
                "height": size[1] if size else None,
            }
        ]

    def _collect_images(self, case: CaseRecord) -> list[SentFrame]:
        candidates = self._gather_candidates(case)
        dicom_n = None
        if case.dicom_study is not None:
            dicom_n = sum(len(s.instances or []) for s in (case.dicom_study.series or []))
        self._last_inventory = study_inventory_metadata(
            candidate_count=len(candidates),
            localizer_candidates=sum(1 for c in candidates if c.is_localizer),
            non_localizer_candidates=sum(1 for c in candidates if not c.is_localizer),
            dicom_instance_count=dicom_n,
        )
        ordered = self._prioritize_candidates(candidates)
        partials: list[dict[str, Any]] = []
        for cand in ordered:
            remaining = self._max_images - len(partials)
            if remaining <= 0:
                break
            partials.extend(self._expand_candidate(cand, remaining))
        if len(partials) < self._max_images:
            locs = [c for c in candidates if c.is_localizer]
            for cand in evenly_sample(locs, self._max_images):
                remaining = self._max_images - len(partials)
                if remaining <= 0:
                    break
                if any(
                    p.get("sop_instance_uid") and p.get("sop_instance_uid") == cand.sop_instance_uid
                    for p in partials
                ):
                    continue
                partials.extend(self._expand_candidate(cand, remaining))
        partials = partials[: self._max_images]
        return [
            SentFrame(
                index=i + 1,
                png=p["png"],
                sop_instance_uid=p.get("sop_instance_uid"),
                series_instance_uid=p.get("series_instance_uid"),
                instance_number=p.get("instance_number"),
                frame_index=int(p.get("frame_index") or 0),
                series_description=p.get("series_description"),
                is_localizer=bool(p.get("is_localizer")),
                width=p.get("width"),
                height=p.get("height"),
                quarantine_rel=p.get("quarantine_rel"),
            )
            for i, p in enumerate(partials)
        ]

    def _processing_meta(self, sent: list[SentFrame]) -> dict[str, str]:
        return {
            "adapter": "openai_compatible_vlm",
            "chat_model_id": self._chat_model_id,
            "timeout_s": str(self._timeout_s),
            "vlm_max_images_cap": str(self._max_images),
            **self._last_inventory,
            **catalog_metadata(sent),
        }

    def _evidence_list_for_synth(self, case: CaseRecord, sent: list[SentFrame]) -> list[EvidenceReference]:
        refs: list[EvidenceReference] = []
        for fr in sent[:4]:
            refs.append(
                evidence_for_frame(
                    finding_id=f"{case.case_id}-vlm-obs",
                    frame=fr,
                    item={"source_image_index": fr.index},
                    image_count=len(sent),
                )
            )
        return refs or [
            EvidenceReference(
                evidence_id=f"{case.case_id}-vlm-obs-ev",
                description=f"VLM inspected {len(sent)} image(s).",
            )
        ]

    def _synthesize_observations(
        self,
        case: CaseRecord,
        base: StructuredFindings,
        *,
        sent: list[SentFrame],
        parsed: dict[str, Any],
    ) -> StructuredFindings:
        """Last resort when the cloud VLM returns findings=[]. Technical notes only."""
        image_count = len(sent)
        warnings = list(base.warnings)
        warnings.append(
            "VLM boş findings[] döndürdü; yalnızca teknik/görünürlük notları yerelde üretildi "
            "(lezyon envanteri değil)."
        )
        model_warnings = [str(w).strip() for w in (parsed.get("warnings") or []) if str(w).strip()]
        quality_note = model_warnings[0] if model_warnings else (
            f"{case.modality.value} / {case.anatomical_region.value} için {image_count} kare "
            "gönderildi; model yapılandırılmış bulgu üretmedi. Teknik kalite veya örnekleme "
            "sınırlı olabilir."
        )
        loc_n = sum(1 for s in sent if s.is_localizer)
        anatomy_note = (
            f"Gönderilen {image_count} karede ({loc_n} lokalizer) {case.anatomical_region.value} "
            f"bölgesi görsel olarak incelendi; VLM yapılandırılmış anatomi/lezyon maddesi yazmadı. "
            "Bu, patoloji yokluğu veya varlığı anlamına gelmez — tüm serilerin uzman radyolog "
            "tarafından incelenmesi gerekir."
        )
        ev = self._evidence_list_for_synth(case, sent)
        findings = [
            Finding(
                finding_id=f"{case.case_id}-vlm-obs-quality",
                finding_code="IMAGE-QUALITY",
                description=quality_note,
                anatomical_location=case.anatomical_region.value,
                finding_status=FindingStatus.NOT_ASSESSED,
                source_model=self.model_id,
                source_model_version=self.version,
                requires_review=True,
                evidence_references=ev[:1] or ev,
                uncertainty_note="Teknik gözlem; klinik lezyon değerlendirmesi değildir.",
                synthetic=False,
                model_confidence=None,
            ),
            Finding(
                finding_id=f"{case.case_id}-vlm-obs-region",
                finding_code="REGION-APPEARANCE",
                description=anatomy_note,
                anatomical_location=case.anatomical_region.value,
                finding_status=FindingStatus.UNCERTAIN,
                source_model=self.model_id,
                source_model_version=self.version,
                requires_review=True,
                evidence_references=ev,
                uncertainty_note="Boş VLM yanıtından türetilmiş teknik görünürlük notu; lezyon iddiası değildir.",
                synthetic=False,
                model_confidence=None,
            ),
        ]
        meta = dict(base.processing_metadata)
        meta["empty_findings_synthesized"] = "true"
        meta.update(self._processing_meta(sent))
        return base.model_copy(
            update={
                "findings": findings,
                "warnings": warnings,
                "execution_status": ModelExecutionStatus.PARTIAL,
                "no_findings_returned": False,
                "processing_metadata": meta,
            }
        )

    def _map_response(
        self,
        case: CaseRecord,
        parsed: dict[str, Any],
        *,
        sent: list[SentFrame],
        batch_index: int = 0,
    ) -> StructuredFindings:
        image_count = len(sent)
        warnings = [str(w) for w in (parsed.get("warnings") or []) if str(w).strip()]
        warnings.append(
            "VLM çıktısı eğitilmemiş genel modelden gelir; klinik doğrulama yoktur. "
            "Her bulgunun IMG/SOP/kesit bağını radyolog doğrulamalıdır."
        )
        status_raw = str(parsed.get("execution_status") or "partial").strip().lower()
        try:
            status = ModelExecutionStatus(status_raw)
        except ValueError:
            status = ModelExecutionStatus.PARTIAL
            warnings.append(f"Unknown execution_status={status_raw!r}; mapped to partial.")

        raw_findings = parsed.get("findings")
        if raw_findings is None:
            raw_findings = []
        if not isinstance(raw_findings, list):
            raise ImagingAdapterError("VLM findings must be a list.")

        findings: list[Finding] = []
        ungrounded = 0
        for i, item in enumerate(raw_findings):
            if not isinstance(item, dict):
                continue
            frame = resolve_source_frame(item, sent)
            item = harden_finding_fields(
                item,
                frame=frame,
                modality=str(case.modality.value if hasattr(case.modality, "value") else case.modality),
            )
            fid = str(item.get("finding_id") or f"{case.case_id}-vlm-b{batch_index + 1}-{i + 1}")
            raw_code = str(item.get("finding_code") or "VLM-FINDING").strip() or "VLM-FINDING"
            code, code_unknown = _normalize_vlm_code(raw_code)
            item["finding_code"] = code
            desc = str(item.get("description") or "").strip()
            if not desc:
                continue
            if frame is None:
                ungrounded += 1
            loc = str(
                item.get("anatomical_location") or case.anatomical_region.value
            ).strip()
            st_raw = str(item.get("finding_status") or "uncertain").strip().lower()
            if st_raw not in _VALID_FINDING_STATUS:
                st_raw = FindingStatus.UNCERTAIN.value
            unc = str(
                item.get("uncertainty_note")
                or "Genel VLM tahmini; veteriner radyolog onayı zorunlu."
            )
            if code_unknown:
                st_raw = FindingStatus.UNCERTAIN.value
                unc = (
                    (unc + " " if unc else "")
                    + f"Serbest bulgu kodu ({raw_code}) allowlist dışında; VLM-UNSPECIFIED."
                ).strip()
            conf = item.get("model_confidence")
            confidence: float | None = None
            if conf is not None:
                try:
                    confidence = float(conf)
                except (TypeError, ValueError):
                    confidence = None
                if confidence is not None and (confidence < 0.0 or confidence > 1.0):
                    confidence = None
            findings.append(
                Finding(
                    finding_id=fid,
                    finding_code=code,
                    description=desc,
                    anatomical_location=loc,
                    finding_status=FindingStatus(st_raw),
                    source_model=self.model_id,
                    source_model_version=self.version,
                    requires_review=True,
                    evidence_references=[
                        evidence_for_frame(
                            finding_id=fid,
                            frame=frame,
                            item=item,
                            image_count=image_count,
                            finding_code=code,
                        )
                    ],
                    uncertainty_note=unc,
                    synthetic=False,
                    model_confidence=confidence,
                )
            )

        if ungrounded:
            warnings.append(
                f"{ungrounded} bulgu geçerli source_image_index olmadan geldi; belirsiz / doğrulanamaz işaretlendi."
            )

        meta = self._processing_meta(sent)
        meta["findings_ungrounded_count"] = str(ungrounded)
        return StructuredFindings(
            case_id=case.case_id,
            study=StudyInfo(
                study_id=case.case_id,
                dicom_available=case.dicom_study is not None,
                metadata_only=False,
            ),
            species=case.species,
            modality=case.modality,
            anatomical_region=case.anatomical_region,
            source_model_id=self.model_id,
            source_model_version=self.version,
            source_kind=SourceKind.REAL,
            execution_status=status,
            findings=findings,
            warnings=warnings,
            review_required=True,
            no_findings_returned=len(findings) == 0,
            absences_not_confirmed=True,
            contributing_model_ids=[self.model_id],
            contributing_source_kinds=[SourceKind.REAL],
            processing_metadata=meta,
        )


def build_optional_vlm_vision(
    *,
    enabled: bool,
    quarantine: QuarantineStore,
    llm_provider: str,
    llm_endpoint: str | None,
    llm_api_key: str | None,
    llm_model_id: str,
    model_id: str = "vlm-vision-v1",
    chat_model_id: str | None = None,
    timeout_s: float = 120.0,
    version: str = "0.1.0-vlm",
    max_images: int = 6,
    max_total_frames: int | None = None,
    include_localizers: bool = False,
    language: str = "tr",
) -> ImagingModel | None:
    """Build VLM adapter when enabled. Reuses LLM credentials by default."""
    if not enabled:
        return None
    kind = (llm_provider or "").strip().lower()
    if kind in {"mock", "stub", "mock-llm", "stub-llm", "deterministic", ""}:
        raise ImagingAdapterError(
            "VETMIND_VLM_ENABLED requires a real VETMIND_LLM_PROVIDER "
            "(gemini, openai, ollama, …), not mock/stub."
        )
    chat_id = (chat_model_id or llm_model_id or "").strip()
    if not chat_id or chat_id == "generic-http-llm":
        raise ImagingAdapterError(
            "VLM Vision requires VETMIND_LLM_MODEL_ID (or VETMIND_VLM_MODEL_ID)."
        )
    endpoint = (llm_endpoint or "").strip()
    if kind in {"gemini", "google"}:
        base_url = endpoint or GEMINI_DEFAULT_BASE_URL
        if not llm_api_key:
            raise ImagingAdapterError("VLM Vision (gemini) requires VETMIND_LLM_API_KEY.")
    elif kind in {"ollama"}:
        base_url = endpoint or "http://127.0.0.1:11434/v1"
    else:
        base_url = endpoint or OPENAI_DEFAULT_BASE_URL
        if base_url.rstrip("/") == OPENAI_DEFAULT_BASE_URL.rstrip("/") and not llm_api_key:
            raise ImagingAdapterError("VLM Vision (openai) requires VETMIND_LLM_API_KEY.")
    if not base_url.startswith(("http://", "https://")):
        raise ImagingAdapterError("VLM base_url must be http(s).")

    return OpenAiCompatibleVlmVisionModel(
        model_id=model_id,
        chat_model_id=chat_id,
        base_url=base_url,
        api_key=llm_api_key,
        quarantine=quarantine,
        timeout_s=timeout_s,
        version=version,
        max_images=max_images,
        max_total_frames=max_total_frames,
        include_localizers=include_localizers,
        language=language,
    )


# Re-export for tests that may patch/import legacy helpers.
_maybe_image_bytes = maybe_image_bytes
