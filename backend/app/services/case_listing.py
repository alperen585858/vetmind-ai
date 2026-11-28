"""Case lists, worklist and the clinic dashboard (part of CaseService)."""

from __future__ import annotations


from app.auth.principal import AuthPrincipal
from app.auth.tenancy import can_access_owned
from app.schemas.case import (
    CaseRecord,
    CaseSummary,
    ClinicDashboardStats,
)
from app.schemas.enums import (
    CaseLifecycleStatus,
)


class CaseListingMixin:
    """Read-side listing for CaseService."""

    def _unread_for(self, case: CaseRecord, principal: AuthPrincipal | None) -> int:
        if principal is None or principal.via == "disabled":
            return 0
        subject = principal.subject
        return sum(1 for m in case.messages if subject not in m.read_by and m.author_id != subject)

    def _reviewer_name(self, subject: str | None, cache: dict[str, str | None] | None = None) -> str | None:
        """Display name of the assigned expert (#77); cached per listing call."""
        if not subject:
            return None
        if cache is not None and subject in cache:
            return cache[subject]
        name = self._note_author_name(subject)
        if cache is not None:
            cache[subject] = name
        return name

    def _to_summary(
        self,
        c: CaseRecord,
        *,
        principal: AuthPrincipal | None = None,
        name_cache: dict[str, str | None] | None = None,
    ) -> CaseSummary:
        return CaseSummary(
            case_id=c.case_id,
            patient_name=c.patient_name,
            species=c.species,
            breed=c.breed,
            patient_age_years=c.patient_age_years,
            modality=c.modality,
            anatomical_region=c.anatomical_region,
            status=c.status,
            priority=getattr(c, "priority", None) or "normal",
            assigned_reviewer_id=c.assigned_reviewer_id,
            assigned_reviewer_name=self._reviewer_name(c.assigned_reviewer_id, name_cache),
            awaiting_review_since=getattr(c, "awaiting_review_since", None),
            review_due_at=getattr(c, "review_due_at", None),
            scenario=c.scenario,
            created_at=c.created_at,
            latest_job_id=c.latest_job_id,
            classification_confirmed=c.classification_confirmed,
            study_instance_uid=c.study.study_instance_uid
            or (c.dicom_study.study_instance_uid if c.dicom_study else None),
            series_count=c.study.series_count
            if c.study.series_count is not None
            else (c.dicom_study.series_count if c.dicom_study else None),
            instance_count=c.study.instance_count
            if c.study.instance_count is not None
            else (c.dicom_study.instance_count if c.dicom_study else None),
            owner_subject=c.owner_subject,
            clinic_id=c.clinic_id,
            referring_clinic=c.referring_clinic,
            complaint=c.clinical_history_structured.complaint if c.clinical_history_structured else None,
            unread_messages=self._unread_for(c, principal),
            report_available_at=getattr(c, "report_available_at", None),
            report_delivered_at=getattr(c, "report_delivered_at", None),
            report_viewed_at=getattr(c, "report_viewed_at", None),
            pet_id=getattr(c, "pet_id", None),
            patient_id=c.patient_id,
            pet_owner_subject=getattr(c, "pet_owner_subject", None),
            owner_contact_name=getattr(c, "owner_contact_name", None),
            owner_contact_email=getattr(c, "owner_contact_email", None),
            owner_email_consent=bool(getattr(c, "owner_email_consent", False)),
            owner_email_delivery_status=getattr(c, "owner_email_delivery_status", None),
            vet_email_delivery_status=getattr(c, "vet_email_delivery_status", None),
            submission_id=getattr(c, "submission_id", None),
            vet_verified=bool(getattr(c, "vet_verified", True)),
            current_report_version=getattr(c, "current_report_version", None)
            or (c.draft_report.version if c.draft_report is not None else None),
            report_version_count=len(getattr(c, "report_versions", None) or [])
            or (1 if c.draft_report is not None else 0),
        )

    def list_cases(self, *, principal: AuthPrincipal | None = None) -> list[CaseSummary]:
        summaries: list[CaseSummary] = []
        names: dict[str, str | None] = {}
        for c in self._repo.list_cases():
            if principal is not None and not can_access_owned(
                principal, c, isolation=self._tenant_isolation
            ):
                continue
            # Pet owners only see finalized (approved) cases linked to them.
            if (
                principal is not None
                and principal.role == "owner"
                and principal.via == "jwt"
                and c.status != CaseLifecycleStatus.APPROVED
            ):
                continue
            if principal is not None and principal.subject.strip().lower() in c.hidden_for:
                continue
            summaries.append(self._to_summary(c, principal=principal, name_cache=names))
        return summaries

    def list_worklist(
        self,
        *,
        principal: AuthPrincipal | None = None,
        status: str | None = None,
        modality: str | None = None,
        priority: str | None = None,
        assigned_to: str | None = None,
        q: str | None = None,
    ) -> list[CaseSummary]:
        """Radiologist worklist: tenant-filtered summaries with optional filters."""
        self.backfill_and_emit_sla_warnings()
        rows = self.list_cases(principal=principal)
        status_l = (status or "").strip().lower()
        modality_l = (modality or "").strip().upper()
        priority_l = (priority or "").strip().lower()
        assigned = (assigned_to or "").strip()
        query = (q or "").strip().lower()

        def _match(s: CaseSummary) -> bool:
            if status_l and s.status.value != status_l:
                return False
            # Cancelled drafts never belong on a worklist unless asked for explicitly.
            if not status_l and s.status == CaseLifecycleStatus.CANCELLED:
                return False
            if modality_l and s.modality.value != modality_l:
                return False
            if priority_l and (s.priority or "normal") != priority_l:
                return False
            if assigned == "unassigned":
                if s.assigned_reviewer_id:
                    return False
            elif assigned and (s.assigned_reviewer_id or "") != assigned:
                return False
            if query:
                hay = " ".join(
                    [
                        s.case_id,
                        s.patient_name,
                        s.breed or "",
                        s.referring_clinic or "",
                        s.clinic_id or "",
                    ]
                ).lower()
                if query not in hay:
                    return False
            return True

        # STAT > URGENT > high (legacy) > NORMAL
        priority_rank = {"stat": 0, "urgent": 1, "high": 2, "normal": 3}
        matched = [s for s in rows if _match(s)]
        matched.sort(
            key=lambda s: (
                priority_rank.get(s.priority or "normal", 9),
                s.created_at,
            )
        )
        return matched

    def clinic_dashboard(
        self,
        *,
        principal: AuthPrincipal | None = None,
        q: str | None = None,
        status: str | None = None,
    ) -> ClinicDashboardStats:
        """Clinic board counters — reuses list_cases tenancy; no duplicate assignment logic."""
        rows = self.list_worklist(principal=principal, status=status, q=q)
        terminal = {
            CaseLifecycleStatus.APPROVED,
            CaseLifecycleStatus.REJECTED,
        }
        active = sum(1 for s in rows if s.status not in terminal)
        awaiting = sum(1 for s in rows if s.status == CaseLifecycleStatus.AWAITING_REVIEW)
        urgent = sum(1 for s in rows if (s.priority or "normal") in {"urgent", "stat"})
        completed = sum(1 for s in rows if s.status == CaseLifecycleStatus.APPROVED)
        unread = sum(s.unread_messages for s in rows)
        return ClinicDashboardStats(
            active_cases=active,
            awaiting_review=awaiting,
            urgent_cases=urgent,
            completed_reports=completed,
            unread_messages=unread,
        )
