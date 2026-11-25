""""Change since the prior study" report section (issue #108).

Deterministic: it diffs the structured findings of the current case against the patient's
most recent approved earlier study (same modality and region) by ``finding_code``. Every
sentence cites its source: ``[F…]`` for this study's findings (the draft's own aliases) and
``[P1]`` for the prior report. The radiologist can edit the text before approval.
"""

from __future__ import annotations

import re

from app.llm.privacy import redact_personal_data
from app.schemas.case import CaseRecord
from app.schemas.enums import ReportStatus
from app.schemas.findings import Finding
from app.schemas.report import DraftReport, ReportComparison

PRIOR_ALIAS = "P1"
_EXCERPT = 220
_ALIAS_RE = re.compile(r"\[([A-Z]+\d+)\]")

_TEXT = {
    "tr": {
        "none": "Karşılaştırılacak önceki tetkik yok.",
        "intro": "{date} tarihli önceki tetkik ile karşılaştırıldı [P1].",
        "new": "Yeni bulgu: {items}.",
        "persisting": "Devam eden bulgu: {items}.",
        "resolved": "Önceki tetkikte bildirilen, bu çalışmada izlenmeyen bulgu: {items} [P1].",
        "unchanged": "Bulgu kodları açısından önceki tetkike göre belirgin değişiklik saptanmadı [P1].",
        "prior_impression": "Önceki izlenim: “{text}” [P1].",
        "caveat": "Değişimin klinik önemi radyolog tarafından değerlendirilmelidir.",
        "unknown_date": "tarihi bilinmeyen",
    },
    "en": {
        "none": "No prior study available for comparison.",
        "intro": "Compared with the prior study of {date} [P1].",
        "new": "New finding: {items}.",
        "persisting": "Persisting finding: {items}.",
        "resolved": "Reported on the prior study, not seen on this study: {items} [P1].",
        "unchanged": "No change in finding codes compared with the prior study [P1].",
        "prior_impression": "Prior impression: “{text}” [P1].",
        "caveat": "The clinical significance of any change must be assessed by the radiologist.",
        "unknown_date": "unknown date",
    },
}


def _lang(language: str | None) -> str:
    return "en" if (language or "").lower().startswith("en") else "tr"


def format_study_date(value: str | None, language: str) -> str | None:
    """DICOM YYYYMMDD → 03.08.2026 (tr) / 2026-08-03 (en)."""
    if not value or not re.fullmatch(r"\d{8}", value):
        return None
    y, m, d = value[:4], value[4:6], value[6:]
    return f"{d}.{m}.{y}" if language == "tr" else f"{y}-{m}-{d}"


def _study_date(case: CaseRecord) -> str | None:
    if case.dicom_study and case.dicom_study.study_date:
        return case.dicom_study.study_date
    return case.created_at.strftime("%Y%m%d")


def _approved_snapshot(case: CaseRecord):
    approved = [v for v in case.report_versions if v.status == ReportStatus.APPROVED]
    return max(approved, key=lambda v: v.version) if approved else None


def _by_code(findings: list[Finding]) -> dict[str, Finding]:
    out: dict[str, Finding] = {}
    for f in findings:
        out.setdefault(f.finding_code, f)
    return out


def _describe(finding: Finding) -> str:
    return " ".join(finding.description.split()).rstrip(".")


def build_comparison(
    case: CaseRecord,
    draft: DraftReport,
    prior: CaseRecord | None,
    *,
    language: str | None = None,
) -> ReportComparison:
    lang = _lang(language)
    t = _TEXT[lang]
    snapshot = _approved_snapshot(prior) if prior is not None else None
    if prior is None or snapshot is None:
        return ReportComparison(text=t["none"])

    current = _by_code(case.structured_findings.findings if case.structured_findings else [])
    previous = _by_code(prior.structured_findings.findings if prior.structured_findings else [])
    alias_of = {fid: alias for alias, fid in draft.citation_map.items() if alias.startswith("F")}

    def cite(f: Finding) -> str:
        alias = alias_of.get(f.finding_id)
        return f"{_describe(f)} [{alias}]" if alias else _describe(f)

    new = [c for c in current if c not in previous]
    persisting = [c for c in current if c in previous]
    resolved = [c for c in previous if c not in current]

    date = format_study_date(_study_date(prior), lang) or t["unknown_date"]
    lines = [t["intro"].format(date=date)]
    if new:
        lines.append(t["new"].format(items="; ".join(cite(current[c]) for c in new)))
    if persisting:
        # Persisting findings cite both this study and the prior report.
        lines.append(t["persisting"].format(items="; ".join(f"{cite(current[c])} [P1]" for c in persisting)))
    if resolved:
        lines.append(t["resolved"].format(items="; ".join(_describe(previous[c]) for c in resolved)))
    if not (new or resolved):
        lines.append(t["unchanged"])

    impression = " ".join(snapshot.content.impression.text.split())
    if impression:
        # The prior text goes through the same personal-data scrub as report prompts.
        known = [(prior.patient_name, "[HASTA]"), (prior.owner_contact_name, "[SAHİP]")]
        scrubbed = redact_personal_data(impression, known=known).text
        scrubbed = _ALIAS_RE.sub("", scrubbed).strip()  # the prior's own [F1]/[S1] mean nothing here
        if len(scrubbed) > _EXCERPT:
            scrubbed = scrubbed[:_EXCERPT].rsplit(" ", 1)[0] + "…"
        lines.append(t["prior_impression"].format(text=scrubbed))
    lines.append(t["caveat"])

    return ReportComparison(
        prior_case_id=prior.case_id,
        prior_study_date=_study_date(prior),
        prior_report_version=snapshot.version,
        text="\n".join(lines),
        new_finding_codes=new,
        persisting_finding_codes=persisting,
        resolved_finding_codes=resolved,
        citation_map={PRIOR_ALIAS: prior.case_id},
    )


def comparison_warnings(draft: DraftReport) -> list[str]:
    """Citation check: every [X] in the section must resolve (P1 → prior, F… → draft)."""
    comp = draft.comparison
    if comp is None:
        return []
    known = set(comp.citation_map) | {a for a in draft.citation_map if a.startswith("F")}
    unknown = sorted({a for a in _ALIAS_RE.findall(comp.text) if a not in known})
    return [f"Comparison section cites unknown source(s): {', '.join(unknown)}"] if unknown else []
