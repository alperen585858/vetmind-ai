"""Radiologist evidence review, manual bboxes and report figures (part of CaseService)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.schemas.case import (
    CaseRecord,
)
from app.schemas.enums import (
    CaseLifecycleStatus,
)
from app.schemas.findings import StructuredFindings
from app.services.activity import append_activity


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseEvidenceMixin:
    """Evidence editing for CaseService."""

    def review_case_evidence(
        self,
        case_id: str,
        evidence_id: str,
        *,
        action: str,
        principal: AuthPrincipal,
        include_in_report: bool | None = None,
        vet_note: str | None = None,
        bbox: object | None = None,
    ) -> StructuredFindings:
        from app.auth.rbac import CAP_TRAINING_VERIFY
        from app.schemas.findings import BoundingBoxEvidence
        from app.services.evidence_review import review_evidence

        if action in {"verify", "unverify"} and principal.via != "disabled":
            if not principal.can(CAP_TRAINING_VERIFY):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Expert verification requires training:verify capability.",
                )

        with self._lock:
            case = self.get_case(case_id, principal=principal)
            self._assert_evidence_editable(case)
            sf = review_evidence(
                case,
                evidence_id,
                action=action,  # type: ignore[arg-type]
                reviewer_id=principal.subject,
                include_in_report=include_in_report,
                vet_note=vet_note,
                bbox=bbox if isinstance(bbox, BoundingBoxEvidence) else None,
            )
            sf = self._render_missing_overlays(case, sf)
            append_activity(
                case,
                kind=f"evidence_{action}",
                actor_subject=principal.subject,
                detail=evidence_id,
            )
            case.updated_at = _now()
            self._repo.save_case(case)
        self._emit_audit(f"evidence.review.{action}", principal=principal, resource=f"{case_id}/{evidence_id}")
        return sf

    def add_case_manual_evidence(
        self,
        case_id: str,
        *,
        finding_id: str,
        principal: AuthPrincipal,
        bbox: object,
        sop_instance_uid: str | None = None,
        frame_index: int | None = None,
        description: str = "Radiologist manual mark",
        include_in_report: bool = True,
    ) -> StructuredFindings:
        from app.schemas.findings import BoundingBoxEvidence
        from app.services.evidence_review import add_manual_evidence

        if not isinstance(bbox, BoundingBoxEvidence):
            raise HTTPException(status_code=400, detail="bbox required")
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            self._assert_evidence_editable(case)
            sf = add_manual_evidence(
                case,
                finding_id=finding_id,
                reviewer_id=principal.subject,
                bbox=bbox,
                sop_instance_uid=sop_instance_uid,
                frame_index=frame_index,
                description=description,
                include_in_report=include_in_report,
            )
            sf = self._render_missing_overlays(case, sf)
            append_activity(
                case,
                kind="evidence_manual_add",
                actor_subject=principal.subject,
                detail=finding_id,
            )
            case.updated_at = _now()
            self._repo.save_case(case)
        self._emit_audit("evidence.manual_add", principal=principal, resource=f"{case_id}/{finding_id}")
        return sf

    def _render_missing_overlays(self, case: CaseRecord, sf: StructuredFindings) -> StructuredFindings:
        """Edited / manual marks need an overlay image, or the approved PDF silently drops them."""
        from app.models.evidence_attach import attach_rendered_evidence
        from app.models.evidence_store import EvidenceArtifactStore

        if not isinstance(self._evidence_store, EvidenceArtifactStore):
            return sf
        try:
            rendered = attach_rendered_evidence(case, sf, store=self._evidence_store)
        except Exception as exc:  # noqa: BLE001 — rendering must not block the review action
            sf.warnings.append(f"Evidence overlay render skipped: {type(exc).__name__}.")
            return sf
        case.structured_findings = rendered
        return rendered

    def append_report_figures(
        self,
        case_id: str,
        evidence_ids: list[str],
        *,
        principal: AuthPrincipal,
    ) -> CaseRecord:
        return self.reports.append_report_figures(case_id, evidence_ids, principal=principal)

    @staticmethod
    def _assert_evidence_editable(case: CaseRecord) -> None:
        """Approved reports are frozen with their evidence; changing it needs a revision first."""
        draft = case.draft_report
        if case.status == CaseLifecycleStatus.APPROVED or (draft is not None and draft.immutable):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Evidence of an approved report cannot change; request a revision first.",
            )
