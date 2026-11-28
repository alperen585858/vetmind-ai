"""Maps a VLM JSON response (or synthesized observations) to StructuredFindings."""

from __future__ import annotations

from typing import Any

from app.models.interfaces import ImagingAdapterError
from app.models.normalizer import normalize_laterality
from app.models.vlm_grounding import (
    SentFrame,
    catalog_metadata,
    evidence_for_frame,
    harden_finding_fields,
    resolve_source_frame,
)
from app.models.vlm_parsing import _VALID_FINDING_STATUS, _normalize_vlm_code
from app.schemas.case import CaseRecord
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import (
    EvidenceReference,
    Finding,
    StructuredFindings,
    StudyInfo,
)


class VlmFindingsMapperMixin:
    """Response → findings mapping for OpenAiCompatibleVlmVisionModel."""

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
            reported_location = str(item.get("anatomical_location") or "")
            loc = reported_location if reported_location.strip() else case.anatomical_region.value
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
                    anatomical_location_reported=bool(reported_location.strip()),
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
                    laterality=normalize_laterality(item.get("laterality")),
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
