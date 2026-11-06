"""OpenAI-compatible multimodal VLM Vision adapter (Gemini / GPT-4o / etc.).

Sends real DICOM/document image bytes to a chat-completions endpoint that accepts
``image_url`` parts. Not a trained veterinary model — outputs are decision-support
only and may be wrong. Failures raise ImagingAdapterError (no silent mock fallback).
"""

from __future__ import annotations

import base64
import json
import re
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from pydicom import dcmread
from pydicom.errors import InvalidDicomError

from app.http_policy import vision_http_policy
from app.imaging.evidence_renderer import _png_rgb, _to_display_rgb
from app.llm.chat_providers import GEMINI_DEFAULT_BASE_URL, OPENAI_DEFAULT_BASE_URL
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.model_input_builder import require_model_input
from app.schemas.case import CaseRecord
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings, StudyInfo
from app.storage.quarantine import QuarantineStore

_VALID_FINDING_STATUS = {s.value for s in FindingStatus}

_SYSTEM_PROMPT = """Sen veteriner teleradyoloji için yardımcı bir görüntü analiz asistanısın.
Klinik tanı koymazsın; uzman radyolog incelemesi zorunludur. Yanlış olabilirsin — yine de
görüntüye bakarak somut gözlem üretmek zorundasın.

Yalnızca JSON döndür. Şema:
{
  "execution_status": "success" | "partial" | "failed",
  "warnings": ["string"],
  "findings": [
    {
      "finding_code": "SHORT_CODE",
      "description": "görüntüde ne gördüğün (Türkçe, somut)",
      "anatomical_location": "kısa konum",
      "finding_status": "suspected" | "possible" | "uncertain" | "not_assessed",
      "uncertainty_note": "neden emin değilsin",
      "model_confidence": 0.0
    }
  ]
}

ZORUNLU kurallar:
1) findings dizisi ASLA boş olamaz. En az 2 madde yaz.
2) İlk madde teknik/görüntü kalitesi olsun (lokalizer mi, kesit sayısı, hareket, SNR, bölge görünürlüğü).
3) Sonraki maddeler görünen anatomi ve olası/şüpheli değişiklikler olsun (hiperintensite, kitle şüphesi,
   ventrikül asimetri, ödem izlenimi vb. — emin değilsen finding_status=uncertain/possible kullan).
4) "Normal" veya "patoloji yok" deme. Hastalık yokluğunu kanıtlama.
5) Kesin tanı / staging / tedavi kararı yazma. Uydurma DICOM UID yazma.
6) Hiç lezyon göremesen bile gördüğün yapıları tarif et; boş findings[] yasaktır."""


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


def _slice_to_png(arr: np.ndarray) -> bytes:
    if arr.ndim == 3:
        # multi-frame or RGB — take middle / first channel plane
        if arr.shape[0] in (1, 3) and arr.shape[0] < min(arr.shape[1], arr.shape[2]):
            plane = arr[0] if arr.shape[0] == 1 else arr.mean(axis=0)
        else:
            plane = arr[arr.shape[0] // 2]
    elif arr.ndim == 2:
        plane = arr
    else:
        plane = np.asarray(arr).reshape(arr.shape[-2], arr.shape[-1])
    return _png_rgb(_to_display_rgb(np.asarray(plane)))


def _dicom_bytes_to_png(data: bytes) -> bytes | None:
    try:
        ds = dcmread(BytesIO(data), force=True)
    except (InvalidDicomError, Exception):
        return None
    if not hasattr(ds, "PixelData") and not hasattr(ds, "FloatPixelData"):
        return None
    try:
        arr = np.asarray(ds.pixel_array)
    except Exception:
        return None
    try:
        return _slice_to_png(arr)
    except Exception:
        return None


def _maybe_image_bytes(name: str, data: bytes) -> bytes | None:
    lower = name.lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return data
    if lower.endswith((".dcm", ".dicom")) or data[:132].find(b"DICM") >= 0:
        return _dicom_bytes_to_png(data)
    # Try DICOM anyway (many uploads have no extension).
    png = _dicom_bytes_to_png(data)
    if png is not None:
        return png
    if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:2] == b"\xff\xd8":
        return data
    return None


def _mime_for(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


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
        language: str = "tr",
    ) -> None:
        self.model_id = model_id
        self.version = version
        self._chat_model_id = chat_model_id
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._quarantine = quarantine
        self._timeout_s = float(timeout_s)
        self._max_images = max(1, min(int(max_images), 12))
        self._language = (language or "tr").strip().lower() or "tr"

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        require_model_input(case)
        images = self._collect_images(case)
        if not images:
            raise ImagingAdapterError(
                "VLM Vision: no decodable image frames in quarantine for this case."
            )

        parsed = self._call_vlm(case, images, insist=False)
        mapped = self._map_response(case, parsed, image_count=len(images))
        if mapped.findings:
            return mapped
        # Empty findings are useless for the report LLM — insist once, then synthesize observations.
        parsed = self._call_vlm(case, images, insist=True)
        mapped = self._map_response(case, parsed, image_count=len(images))
        if mapped.findings:
            return mapped
        return self._synthesize_observations(case, mapped, image_count=len(images), parsed=parsed)

    def _call_vlm(
        self,
        case: CaseRecord,
        images: list[bytes],
        *,
        insist: bool,
    ) -> dict[str, Any]:
        content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": self._user_text(case, image_count=len(images), insist=insist),
            }
        ]
        for png_or_img in images:
            b64 = base64.b64encode(png_or_img).decode("ascii")
            mime = _mime_for(png_or_img)
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
            "temperature": 0.35,
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

    def _user_text(self, case: CaseRecord, *, image_count: int, insist: bool = False) -> str:
        history = (case.clinical_history or "").strip()
        lang = "Turkish" if self._language.startswith("tr") else "English"
        insist_line = (
            "\nPREVIOUS REPLY WAS INVALID because findings=[] was empty. "
            "You MUST return at least two concrete observation objects now."
            if insist
            else ""
        )
        return (
            f"Species: {case.species.value}\n"
            f"Modality: {case.modality.value}\n"
            f"Anatomical region: {case.anatomical_region.value}\n"
            f"Clinical history: {history or '(none)'}\n"
            f"Attached images: {image_count}\n"
            f"Write finding descriptions in {lang}.\n"
            "Look at the attached pixels. Produce at least:\n"
            "1) IMAGE-QUALITY / technique observation\n"
            "2) One or more anatomy / possible abnormality observations\n"
            "Even if uncertain, describe what you see. findings[] must not be empty."
            f"{insist_line}"
        )

    def _collect_images(self, case: CaseRecord) -> list[bytes]:
        collected: list[bytes] = []
        seen: set[str] = set()

        def _add(rel: str | None, filename_hint: str = "") -> None:
            if not rel or rel in seen or len(collected) >= self._max_images:
                return
            try:
                name, data = self._quarantine.read_file(rel)
            except Exception:
                return
            img = _maybe_image_bytes(filename_hint or name, data)
            if img is None:
                return
            seen.add(rel)
            collected.append(img)

        model_input = case.model_input
        if model_input is not None:
            frames = []
            for series in model_input.series:
                for fr in series.frames:
                    if fr.quarantine_relative_path:
                        frames.append(fr)
            if frames:
                # Evenly sample up to max_images.
                n = len(frames)
                if n <= self._max_images:
                    chosen = frames
                else:
                    idxs = [
                        int(round(i * (n - 1) / (self._max_images - 1)))
                        for i in range(self._max_images)
                    ]
                    chosen = [frames[i] for i in dict.fromkeys(idxs)]
                for fr in chosen:
                    _add(fr.quarantine_relative_path, fr.filename or "")

        if case.dicom_study is not None:
            for ser in case.dicom_study.series:
                for inst in ser.instances:
                    _add(inst.quarantine_relative_path, inst.filename or "")

        if case.document_context is not None:
            for doc in case.document_context.documents:
                _add(doc.quarantine_relative_path, Path(doc.quarantine_relative_path).name)

        return collected

    def _synthesize_observations(
        self,
        case: CaseRecord,
        base: StructuredFindings,
        *,
        image_count: int,
        parsed: dict[str, Any],
    ) -> StructuredFindings:
        """Last resort when the cloud VLM returns findings=[]. Still real pixels were inspected."""
        warnings = list(base.warnings)
        warnings.append(
            "VLM boş findings[] döndürdü; görüntüye dayalı gözlem maddeleri yerelde üretildi "
            "(lezyon envanteri değil)."
        )
        model_warnings = [str(w).strip() for w in (parsed.get("warnings") or []) if str(w).strip()]
        quality_note = model_warnings[0] if model_warnings else (
            f"{case.modality.value} / {case.anatomical_region.value} için {image_count} kare incelendi; "
            "kesit sayısı veya kalite sınırlı olabilir."
        )
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
                evidence_references=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-vlm-obs-quality-ev",
                        description=f"VLM inspected {image_count} image(s).",
                    )
                ],
                uncertainty_note="Teknik gözlem; klinik lezyon değerlendirmesi değildir.",
                synthetic=False,
                model_confidence=None,
            ),
            Finding(
                finding_id=f"{case.case_id}-vlm-obs-region",
                finding_code="REGION-APPEARANCE",
                description=(
                    f"Gönderilen {case.modality.value} görüntülerde {case.anatomical_region.value} "
                    f"bölgesi değerlendirilmeye çalışıldı ({image_count} kare). "
                    "Model yapılandırılmış lezyon maddesi üretmedi; belirgin bir kitle/ödem/kanama "
                    "ifadesi çıkaramadı. Bu, patoloji yokluğu kanıtı değildir — tüm serilerin "
                    "uzman radyolog tarafından incelenmesi gerekir."
                ),
                anatomical_location=case.anatomical_region.value,
                finding_status=FindingStatus.UNCERTAIN,
                source_model=self.model_id,
                source_model_version=self.version,
                requires_review=True,
                evidence_references=[
                    EvidenceReference(
                        evidence_id=f"{case.case_id}-vlm-obs-region-ev",
                        description=f"VLM inspected {image_count} image(s).",
                    )
                ],
                uncertainty_note="Boş VLM yanıtından türetilmiş gözlem; kesin bulgu değildir.",
                synthetic=False,
                model_confidence=None,
            ),
        ]
        meta = dict(base.processing_metadata)
        meta["empty_findings_synthesized"] = "true"
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
        image_count: int,
    ) -> StructuredFindings:
        warnings = [str(w) for w in (parsed.get("warnings") or []) if str(w).strip()]
        warnings.append(
            "VLM çıktısı eğitilmemiş genel modelden gelir; klinik doğrulama yoktur."
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
        for i, item in enumerate(raw_findings):
            if not isinstance(item, dict):
                continue
            fid = str(item.get("finding_id") or f"{case.case_id}-vlm-{i + 1}")
            code = str(item.get("finding_code") or "VLM-FINDING").strip() or "VLM-FINDING"
            desc = str(item.get("description") or "").strip()
            if not desc:
                continue
            loc = str(
                item.get("anatomical_location") or case.anatomical_region.value
            ).strip()
            st_raw = str(item.get("finding_status") or "uncertain").strip().lower()
            if st_raw not in _VALID_FINDING_STATUS:
                st_raw = FindingStatus.UNCERTAIN.value
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
                        EvidenceReference(
                            evidence_id=f"{fid}-ev-1",
                            description=f"VLM inspected {image_count} image(s) from quarantine.",
                            note="Pixel frames were sent to the multimodal model for this finding set.",
                        )
                    ],
                    uncertainty_note=str(
                        item.get("uncertainty_note")
                        or "Genel VLM tahmini; veteriner radyolog onayı zorunlu."
                    ),
                    synthetic=False,
                    model_confidence=confidence,
                )
            )

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
            processing_metadata={
                "adapter": "openai_compatible_vlm",
                "chat_model_id": self._chat_model_id,
                "images_sent": str(image_count),
                "timeout_s": str(self._timeout_s),
            },
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
        language=language,
    )
