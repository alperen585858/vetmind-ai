"""HTTP Vision / VLM adapter skeleton for a remote inference service.

When ``VETMIND_VISION_ENDPOINT`` is set, the adapter POSTs ``ImagingModelInput``
(+ case metadata) to that URL and maps the JSON response into StructuredFindings.

This is not a trained model. It is the production-shaped extension point.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.models.interfaces import ImagingAdapterError, ImagingModel
from app.models.model_input_builder import ensure_model_input
from app.schemas.case import CaseRecord
from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings


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
        model_input = ensure_model_input(case)
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
        try:
            with httpx.Client(timeout=self._timeout_s) as client:
                res = client.post(self._endpoint, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise ImagingAdapterError(f"Remote vision HTTP error: {type(exc).__name__}: {exc}") from exc

        if res.status_code >= 400:
            raise ImagingAdapterError(
                f"Remote vision returned HTTP {res.status_code}: {res.text[:300]}"
            )

        try:
            body: dict[str, Any] = res.json()
        except ValueError as exc:
            raise ImagingAdapterError("Remote vision response is not JSON.") from exc

        return self._map_response(case, body)

    def _map_response(self, case: CaseRecord, body: dict[str, Any]) -> StructuredFindings:
        status_raw = str(body.get("execution_status", "success")).lower()
        try:
            status = ModelExecutionStatus(status_raw)
        except ValueError:
            status = ModelExecutionStatus.SUCCESS

        warnings = [
            "Output mapped from remote Vision HTTP adapter.",
            "Clinically validated only if the remote service and radiologist confirm.",
        ]
        for w in body.get("warnings") or []:
            warnings.append(str(w))

        findings: list[Finding] = []
        for i, item in enumerate(body.get("findings") or []):
            if not isinstance(item, dict):
                continue
            fid = str(item.get("finding_id") or f"{case.case_id}-remote-{i+1}")
            code = str(item.get("finding_code") or "REMOTE-FINDING")
            desc = str(item.get("description") or "Remote adapter finding.")
            loc = str(item.get("anatomical_location") or case.anatomical_region.value)
            st_raw = str(item.get("finding_status") or "uncertain").lower()
            try:
                fstatus = FindingStatus(st_raw)
            except ValueError:
                fstatus = FindingStatus.UNCERTAIN
            evidence = []
            for j, ev in enumerate(item.get("evidence_references") or []):
                if not isinstance(ev, dict):
                    continue
                evidence.append(
                    EvidenceReference(
                        evidence_id=str(ev.get("evidence_id") or f"{fid}-ev-{j+1}"),
                        description=str(ev.get("description") or "Remote evidence"),
                        series_hint=ev.get("series_hint"),
                        note=str(ev.get("note") or "From remote Vision service."),
                    )
                )
            findings.append(
                Finding(
                    finding_id=fid,
                    finding_code=code,
                    description=desc,
                    anatomical_location=loc,
                    finding_status=fstatus,
                    source_model=self.model_id,
                    source_model_version=self.version,
                    requires_review=True,
                    evidence_references=evidence,
                    uncertainty_note=str(item.get("uncertainty_note") or "Remote model uncertainty."),
                    synthetic=bool(item.get("synthetic", False)),
                )
            )

        source_kind = SourceKind.REAL
        if body.get("source_kind") == "mock":
            source_kind = SourceKind.MOCK
        elif body.get("source_kind") == "mixed":
            source_kind = SourceKind.MIXED

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
        )


def build_optional_http_vision(
    *,
    endpoint: str | None,
    model_id: str = "remote-vision-v1",
    api_key: str | None = None,
) -> ImagingModel | None:
    if not endpoint:
        return None
    return HttpRemoteVisionModel(model_id=model_id, endpoint=endpoint, api_key=api_key)
