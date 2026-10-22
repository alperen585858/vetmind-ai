"""HTTP Vision / VLM adapter skeleton for a remote inference service.

When ``VETMIND_VISION_ENDPOINT`` is set, the adapter POSTs ``ImagingModelInput``
(+ case metadata) to that URL and maps the JSON response into StructuredFindings.

This is not a trained model. It is the production-shaped extension point.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.http_policy import vision_http_policy
from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.model_input_builder import require_model_input
from app.schemas.case import CaseRecord
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings

_VALID_EXECUTION = {s.value for s in ModelExecutionStatus}
_VALID_SOURCE_KIND = {s.value for s in SourceKind}
_VALID_FINDING_STATUS = {s.value for s in FindingStatus}


class RemoteEvidencePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    evidence_id: Optional[str] = None
    description: Optional[str] = None
    series_hint: Optional[str] = None
    study_instance_uid: Optional[str] = None
    series_instance_uid: Optional[str] = None
    sop_instance_uid: Optional[str] = None
    frame_index: Optional[int] = None
    note: Optional[str] = None


class RemoteFindingPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    finding_id: Optional[str] = None
    finding_code: Optional[str] = None
    description: Optional[str] = None
    anatomical_location: Optional[str] = None
    finding_status: Optional[str] = None
    evidence_references: list[RemoteEvidencePayload] = Field(default_factory=list)
    uncertainty_note: Optional[str] = None
    synthetic: Optional[bool] = None
    # Optional model-provided confidence — never invented by VetMind if absent.
    model_confidence: Optional[float] = None


class RemoteVisionResponse(BaseModel):
    """Strict wire contract for remote Vision HTTP JSON bodies."""

    model_config = ConfigDict(extra="ignore")

    execution_status: str
    findings: list[RemoteFindingPayload] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    source_kind: Optional[str] = None

    @field_validator("execution_status", mode="before")
    @classmethod
    def _require_execution_status(cls, value: Any) -> str:
        if value is None:
            raise ValueError("execution_status is required and must not be null")
        text = str(value).strip()
        if not text:
            raise ValueError("execution_status is required and must not be empty")
        return text.lower()

    @field_validator("findings", mode="before")
    @classmethod
    def _require_findings_list(cls, value: Any) -> Any:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("findings must be a list when present")
        return value

    @field_validator("warnings", mode="before")
    @classmethod
    def _coerce_warnings(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("warnings must be a list when present")
        return [str(w) for w in value]


class HttpRemoteVisionModel:
    """Calls a remote Vision/VLM HTTP API. Failures raise ImagingAdapterError."""

    def __init__(
        self,
        *,
        model_id: str,
        endpoint: str,
        version: str = "0.1.0-http",
        timeout_s: float = 30.0,
        api_key: str | None = None,
    ) -> None:
        self.model_id = model_id
        self.version = version
        self._endpoint = endpoint.rstrip("/")
        self._timeout_s = timeout_s
        self._api_key = api_key

    def analyze(self, case: CaseRecord) -> StructuredFindings:
        # Read-only: orchestrator must have attached ImagingModelInput already.
        model_input = require_model_input(case)
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        payload = {
            "model_id": self.model_id,
            "case_id": case.case_id,
            "model_input": model_input.model_dump(mode="json"),
            "species": case.species.value,
            "modality": case.modality.value,
            "anatomical_region": case.anatomical_region.value,
            "clinical_history": case.clinical_history,
            "note": "Remote Vision request. Server must not invent clinical certainty.",
        }
        policy = vision_http_policy(self._timeout_s)
        try:
            with httpx.Client(timeout=policy.timeout_s) as client:
                # POST is never auto-retried (non-idempotent inference).
                res = client.post(self._endpoint, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise ImagingAdapterError(
                f"Remote vision timed out after {policy.timeout_s}s."
            ) from exc
        except httpx.HTTPError as exc:
            raise ImagingAdapterError(f"Remote vision HTTP error: {type(exc).__name__}: {exc}") from exc

        if res.status_code >= 400:
            raise ImagingAdapterError(
                f"Remote vision returned HTTP {res.status_code}: {res.text[:300]}"
            )

        try:
            body: Any = res.json()
        except ValueError as exc:
            raise ImagingAdapterError("Remote vision response is not JSON.") from exc

        if not isinstance(body, dict):
            raise ImagingAdapterError("Remote vision response must be a JSON object.")

        return self._map_response(case, body)

    def _parse_response(self, body: dict[str, Any]) -> RemoteVisionResponse:
        try:
            return RemoteVisionResponse.model_validate(body)
        except ValidationError as exc:
            raise ImagingAdapterError(
                f"Remote vision response failed validation: {exc.errors()[0]['msg']}"
            ) from exc

    def _map_response(self, case: CaseRecord, body: dict[str, Any]) -> StructuredFindings:
        parsed = self._parse_response(body)

        if parsed.execution_status not in _VALID_EXECUTION:
            raise ImagingAdapterError(
                f"Remote vision returned unknown execution_status={parsed.execution_status!r}. "
                f"Allowed: {sorted(_VALID_EXECUTION)}."
            )
        status = ModelExecutionStatus(parsed.execution_status)

        source_kind = SourceKind.REAL
        if parsed.source_kind is not None:
            sk = parsed.source_kind.strip().lower()
            if sk not in _VALID_SOURCE_KIND:
                raise ImagingAdapterError(
                    f"Remote vision returned unknown source_kind={parsed.source_kind!r}."
                )
            source_kind = SourceKind(sk)

        warnings = [
            "Output mapped from remote Vision HTTP adapter.",
            "Clinically validated only if the remote service and radiologist confirm.",
            "source_kind=real does not imply clinical validation.",
        ]
        warnings.extend(parsed.warnings)

        # Never fabricate findings for FAILED remote execution.
        findings: list[Finding] = []
        if status == ModelExecutionStatus.FAILED:
            if parsed.findings:
                warnings.append(
                    "Remote execution_status=failed; ignoring finding payloads "
                    "(findings are not fabricated from a failed remote response)."
                )
        else:
            for i, item in enumerate(parsed.findings):
                findings.append(self._map_finding(case, item, i, source_kind, warnings))

        return StructuredFindings(
            case_id=case.case_id,
            study=case.study,
            species=case.species,
            modality=case.modality,
            anatomical_region=case.anatomical_region,
            source_model_id=self.model_id,
            source_model_version=self.version,
            source_kind=source_kind,
            execution_status=status,
            findings=findings,
            warnings=warnings,
            review_required=True,
            no_findings_returned=len(findings) == 0,
            absences_not_confirmed=True,
            contributing_model_ids=[self.model_id],
            contributing_source_kinds=[source_kind],
            processing_metadata={
                "adapter": "http_remote_vision",
                "timeout_s": str(self._timeout_s),
                "endpoint_configured": "true",
            },
        )

    def _map_finding(
        self,
        case: CaseRecord,
        item: RemoteFindingPayload,
        index: int,
        source_kind: SourceKind,
        warnings: list[str],
    ) -> Finding:
        fid = str(item.finding_id or f"{case.case_id}-remote-{index + 1}")
        code = str(item.finding_code or "REMOTE-FINDING")
        desc = str(item.description or "Remote adapter finding.")
        loc = str(item.anatomical_location or case.anatomical_region.value)

        if item.finding_status is None or not str(item.finding_status).strip():
            fstatus = FindingStatus.UNCERTAIN
        else:
            st_raw = str(item.finding_status).strip().lower()
            if st_raw not in _VALID_FINDING_STATUS:
                warnings.append(
                    f"Finding {fid}: unknown finding_status={item.finding_status!r}; "
                    "mapped to uncertain."
                )
                fstatus = FindingStatus.UNCERTAIN
            else:
                fstatus = FindingStatus(st_raw)

        # Default synthetic from source_kind — never inherit schema default True for REAL.
        if item.synthetic is None:
            synthetic = source_kind != SourceKind.REAL
        else:
            synthetic = bool(item.synthetic)

        if source_kind == SourceKind.REAL and synthetic:
            warnings.append(
                f"Finding {fid}: contradictory provenance "
                "(source_kind=real with synthetic=true); preserved for review, not rewritten."
            )
        if source_kind == SourceKind.MOCK and not synthetic:
            warnings.append(
                f"Finding {fid}: contradictory provenance "
                "(source_kind=mock with synthetic=false); preserved for review, not rewritten."
            )

        evidence: list[EvidenceReference] = []
        for j, ev in enumerate(item.evidence_references):
            evidence.append(
                EvidenceReference(
                    evidence_id=str(ev.evidence_id or f"{fid}-ev-{j + 1}"),
                    description=str(ev.description or "Remote evidence"),
                    series_hint=ev.series_hint,
                    study_instance_uid=ev.study_instance_uid,
                    series_instance_uid=ev.series_instance_uid,
                    sop_instance_uid=ev.sop_instance_uid,
                    frame_index=ev.frame_index,
                    note=str(ev.note or "From remote Vision service."),
                )
            )

        confidence: float | None = None
        if item.model_confidence is not None:
            try:
                conf = float(item.model_confidence)
            except (TypeError, ValueError) as exc:
                raise ImagingAdapterError(
                    f"Finding {fid}: model_confidence must be a number when present."
                ) from exc
            if conf < 0.0 or conf > 1.0:
                raise ImagingAdapterError(
                    f"Finding {fid}: model_confidence={conf} out of range [0, 1]."
                )
            confidence = conf

        return Finding(
            finding_id=fid,
            finding_code=code,
            description=desc,
            anatomical_location=loc,
            finding_status=fstatus,
            source_model=self.model_id,
            source_model_version=self.version,
            requires_review=True,
            evidence_references=evidence,
            uncertainty_note=str(item.uncertainty_note or "Remote model uncertainty."),
            synthetic=synthetic,
            model_confidence=confidence,
        )


def build_optional_http_vision(
    *,
    endpoint: str | None,
    model_id: str = "remote-vision-v1",
    api_key: str | None = None,
    timeout_s: float = 30.0,
    version: str = "0.1.0-http",
) -> ImagingModel | None:
    if not endpoint:
        return None
    return HttpRemoteVisionModel(
        model_id=model_id,
        endpoint=endpoint,
        api_key=api_key,
        timeout_s=timeout_s,
        version=version,
    )
