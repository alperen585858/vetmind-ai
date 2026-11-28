"""OpenAI-compatible multimodal VLM Vision adapter (Gemini / GPT-4o / etc.).

Sends real DICOM/document image bytes to a chat-completions endpoint that accepts
``image_url`` parts. Not a trained veterinary model — outputs are decision-support
only and may be wrong. Failures raise ImagingAdapterError (no silent mock fallback).

Each finding is grounded to an IMG-# catalog entry (series / SOP / instance / frame,
optional bbox) so a radiologist can verify the claim on the same pixels.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx

from app.http_policy import vision_http_policy
from app.imaging.analysis_limitations import (
    MISSING_PREFIX,
    context_gaps,
    sampling_limitation,
    sequence_limitations,
    sequence_summary_lines,
)
from app.imaging.display_png import (
    maybe_image_bytes,
)
from app.imaging.systematic_checklist import (
    checklist_prompt,
    merge_systematic_review,
    parse_systematic_review,
)
from app.llm.chat_providers import GEMINI_DEFAULT_BASE_URL, OPENAI_DEFAULT_BASE_URL
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.model_input_builder import require_model_input
from app.models.study_inventory import build_study_inventory
from app.models.vlm_batch_planner import plan_visual_analysis
from app.models.vlm_findings_mapper import VlmFindingsMapperMixin
from app.models.vlm_grounding import (
    SentFrame,
    catalog_metadata,
    format_image_catalog,
    study_inventory_metadata,
)
from app.models.vlm_image_collection import VlmImageCollectionMixin
from app.models.vlm_parsing import (  # noqa: F401  (re-exported)
    _STATUS_UNCERTAINTY_RANK,
    _VALID_FINDING_STATUS,
    _VLM_MAX_EDGE,
    _dedupe_findings,
    _dicom_frame_count,
    _extract_json_object,
    _ImageCandidate,
    _looks_like_dicom,
    _mime_for,
    _normalize_vlm_code,
    _png_size,
    _review_locus,
)
from app.models.vlm_prompt import _SYSTEM_PROMPT, VLM_PROMPT_VERSION  # noqa: F401  (re-exported)
from app.models.vlm_result_cache import VlmBatchResultCache, batch_cache_key
from app.schemas.analysis_coverage import SeriesCoverage
from app.schemas.case import CaseRecord
from app.schemas.enums import ModelExecutionStatus, SourceKind
from app.schemas.findings import Finding, StructuredFindings, StudyInfo
from app.storage.quarantine import QuarantineStore


class OpenAiCompatibleVlmVisionModel(VlmImageCollectionMixin, VlmFindingsMapperMixin):
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

        # Context that changes the answer (prompt text, species/breed/age/history) invalidates cache.
        from app.llm.gateway import compose_history

        history_text = compose_history(case)
        prompt_fp = "|".join(
            [
                VLM_PROMPT_VERSION,
                hashlib.sha256(_SYSTEM_PROMPT.encode("utf-8")).hexdigest()[:16],
                case.species.value,
                case.breed or "",
                str(case.patient_age_years),
                history_text,
            ]
        )
        review_batches: list = []

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
                prompt_fingerprint=prompt_fp,
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
            review_batches.append(
                parse_systematic_review(parsed, sent=sent, locus_for=_review_locus)
            )
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

        sampling_note = sampling_limitation(case.modality, coverage.frames_visually_analyzed)
        if sampling_note:
            coverage = coverage.model_copy(
                update={"limited_sampling": True, "limited_sampling_reason": sampling_note}
            )
            all_warnings.append(f"{MISSING_PREFIX} {sampling_note}")
        all_warnings.extend(sequence_limitations(all_sent, case.modality))
        all_warnings.extend(context_gaps(case, history_text=history_text))

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
        elif coverage.analysis_scope == "full" and not coverage.limited_sampling:
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
        seq_lines = sequence_summary_lines(all_sent)
        if seq_lines:
            meta["mr_sequence_summary"] = "\n".join(seq_lines)[:2000]
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
        elif coverage.limited_sampling:
            # Every uploaded frame was seen, but a 1–2 slice MR/CT is not a reviewed study.
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
            systematic_review=merge_systematic_review(
                review_batches, region=case.anatomical_region
            ),
        )

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
        # Same composition + PII redaction as the report LLM (structured history, neuro exam).
        from app.llm.gateway import compose_history
        from app.llm.privacy import redact_personal_data

        history = redact_personal_data(
            compose_history(case),
            known=[(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")],
        ).text.strip()[:2000]
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
        age = f"{case.patient_age_years:g} years" if case.patient_age_years is not None else "(unknown)"
        return (
            f"Species: {case.species.value}\n"
            f"Breed: {(case.breed or '').strip() or '(unknown)'}\n"
            f"Age: {age}\n"
            f"Modality: {case.modality.value}\n"
            f"Anatomical region: {case.anatomical_region.value}\n"
            f"Clinical history: {history or '(none)'}\n"
            f"{inventory_line}"
            f"{format_image_catalog(sent)}\n"
            f"{checklist_prompt(case.anatomical_region)}\n"
            f"Write finding descriptions in {lang}.\n"
            "Every finding MUST set source_image_index to an IMG-n above.\n"
            "1) IMAGE-QUALITY on a real IMG\n"
            "2) Visible anatomy / only pixel-supported changes\n"
            "3) systematic_review: one item per checklist region\n"
            "No unsupported lesions. No pathology from unknown MR sequence signal."
            f"{insist_line}"
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
