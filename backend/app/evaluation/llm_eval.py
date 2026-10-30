"""Score LLM draft reports against an evaluation set.

Each case supplies fixed imaging findings (so models are compared on the same input),
plus expected differentials, phrases that must appear and phrases that must not.
Metrics are reported per case and averaged per model. They measure grounding and
safety behaviour; they are not clinical accuracy — that needs expert review.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from statistics import mean
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.llm.gateway import LLMGateway
from app.llm.grounding import analyze_grounding
from app.llm.interfaces import LLMProvider, LLMProviderError
from app.rag.retriever import RagRetriever
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.findings import Finding, StructuredFindings
from app.schemas.report import DraftReport

SECTIONS = ("technique", "findings", "impression", "recommendations")


class EvalFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    description: str
    location: str
    status: FindingStatus = FindingStatus.SUSPECTED


class EvalExpected(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Each entry is "term|synonym|…"; one hit is enough for that entry.
    differentials: list[str] = Field(default_factory=list)
    must_mention: list[str] = Field(default_factory=list)
    forbidden: list[str] = Field(default_factory=list)


class EvalCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str = ""
    species: Species
    breed: Optional[str] = None
    age_years: Optional[float] = None
    modality: Modality
    region: AnatomicalRegion
    clinical_history: str = ""
    execution_status: ModelExecutionStatus = ModelExecutionStatus.SUCCESS
    no_findings_returned: bool = False
    findings: list[EvalFinding] = Field(default_factory=list)
    expected: EvalExpected = Field(default_factory=EvalExpected)


class EvalSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = 1
    name: str = ""
    note: str = ""
    cases: list[EvalCase]


def load_eval_set(path: Path) -> EvalSet:
    return EvalSet.model_validate(json.loads(Path(path).read_text(encoding="utf-8")))


def to_pipeline_inputs(ec: EvalCase) -> tuple[CaseRecord, StructuredFindings]:
    case_id = f"eval-{ec.id}"
    case = CaseRecord(
        case_id=case_id,
        patient_name="Eval",
        species=ec.species,
        breed=ec.breed,
        patient_age_years=ec.age_years,
        modality=ec.modality,
        anatomical_region=ec.region,
        clinical_history=ec.clinical_history or None,
    )
    findings = StructuredFindings(
        case_id=case_id,
        species=ec.species,
        modality=ec.modality,
        anatomical_region=ec.region,
        source_model_id="eval-fixture",
        source_model_version="eval-set",
        source_kind=SourceKind.MOCK,
        execution_status=ec.execution_status,
        no_findings_returned=ec.no_findings_returned,
        findings=[
            Finding(
                finding_id=f"{case_id}-f{i}",
                finding_code=f.code,
                description=f.description,
                anatomical_location=f.location,
                finding_status=f.status,
                source_model="eval-fixture",
                synthetic=True,
            )
            for i, f in enumerate(ec.findings, 1)
        ],
    )
    return case, findings


_FOLD = str.maketrans("çğıİöşüÇĞÖŞÜâîû–", "cgiiosucgosuaiu-")


def _norm(text: str) -> str:
    return text.translate(_FOLD).lower()


def term_found(text: str, entry: str) -> bool:
    hay = _norm(text)
    return any(alt.strip() and _norm(alt.strip()) in hay for alt in entry.split("|"))


def recall(text: str, entries: list[str]) -> Optional[float]:
    if not entries:
        return None
    return sum(term_found(text, e) for e in entries) / len(entries)


EN_STOPWORDS = frozenset(
    "the and of with is are was were in to for an this that be may or on by as at from not "
    "should due further consider recommended suggest suggests likely possible region study "
    "findings evidence lesion mass".split()
)
_WORD_RE = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşü]+")


def english_ratio(text: str) -> float:
    """Share of words that are common English words — a proxy for language mixing."""
    words = [w.lower() for w in _WORD_RE.findall(text)]
    if not words:
        return 0.0
    return sum(w in EN_STOPWORDS for w in words) / len(words)


@dataclass
class CaseResult:
    case_id: str
    ok: bool
    latency_s: float
    error: str = ""
    citation_coverage: Optional[float] = None
    finding_coverage: Optional[float] = None
    uncited: int = 0
    unknown_refs: int = 0
    overclaims: list[str] = field(default_factory=list)
    differential_recall: Optional[float] = None
    must_mention_recall: Optional[float] = None
    forbidden_hits: list[str] = field(default_factory=list)
    english_ratio: Optional[float] = None
    blank_sections: list[str] = field(default_factory=list)
    differentials: list[str] = field(default_factory=list)
    sections: dict[str, str] = field(default_factory=dict)

    @property
    def score(self) -> Optional[float]:
        """Composite 0–100. Equal-weight mean of the applicable checks (documented in LLM_KATMANI.md)."""
        if not self.ok:
            return 0.0
        parts = [
            self.citation_coverage,
            self.finding_coverage,
            self.differential_recall,
            self.must_mention_recall,
            0.0 if self.overclaims or self.unknown_refs else 1.0,
            0.0 if self.forbidden_hits else 1.0,
            1.0 - min(1.0, (self.english_ratio or 0.0) * 4),
            # Findings/impression left blank (placeholder inserted) is a failure, not "no claims".
            1.0 - len({"findings", "impression"} & set(self.blank_sections)) / 2,
        ]
        vals = [p for p in parts if p is not None]
        return round(100 * mean(vals), 1)


def score_report(ec: EvalCase, report: DraftReport, latency_s: float) -> CaseResult:
    stats = analyze_grounding(report)
    sections = {k: getattr(report, k).text for k in SECTIONS}
    full = "\n".join(sections.values())
    return CaseResult(
        case_id=ec.id,
        ok=True,
        latency_s=round(latency_s, 2),
        citation_coverage=round(stats.citation_coverage, 3),
        finding_coverage=round(stats.finding_coverage, 3) if stats.finding_aliases else None,
        uncited=stats.uncited_count,
        unknown_refs=sum(len(v) for v in stats.unknown_refs.values()),
        overclaims=[f"{s}: {label} ({text})" for s, label, text in stats.overclaims],
        differential_recall=recall(
            sections["impression"] + "\n" + "\n".join(d.name for d in report.differentials),
            ec.expected.differentials,
        ),
        differentials=[f"{d.name} ({d.likelihood})" for d in report.differentials],
        must_mention_recall=recall(full, ec.expected.must_mention),
        forbidden_hits=[e for e in ec.expected.forbidden if term_found(full, e)],
        english_ratio=round(english_ratio(full), 3),
        blank_sections=list(stats.blank_sections),
        sections=sections,
    )


@dataclass
class RunResult:
    label: str
    provider_id: str
    model_id: str
    prompt_version: str
    cases: list[CaseResult]

    def summary(self) -> dict[str, Optional[float]]:
        ok = [c for c in self.cases if c.ok]

        def avg(attr: str) -> Optional[float]:
            vals = [getattr(c, attr) for c in ok if getattr(c, attr) is not None]
            return round(mean(vals), 3) if vals else None

        return {
            "score": round(mean(c.score or 0.0 for c in self.cases), 1) if self.cases else None,
            "success_rate": round(len(ok) / len(self.cases), 3) if self.cases else None,
            "citation_coverage": avg("citation_coverage"),
            "finding_coverage": avg("finding_coverage"),
            "differential_recall": avg("differential_recall"),
            "must_mention_recall": avg("must_mention_recall"),
            "overclaim_cases": float(sum(bool(c.overclaims) for c in ok)),
            "forbidden_cases": float(sum(bool(c.forbidden_hits) for c in ok)),
            "unknown_refs": float(sum(c.unknown_refs for c in ok)),
            "blank_cases": float(sum(bool(c.blank_sections) for c in ok)),
            "english_ratio": avg("english_ratio"),
            "latency_s": avg("latency_s"),
        }

    def to_json(self) -> dict:
        return {
            "label": self.label,
            "provider_id": self.provider_id,
            "model_id": self.model_id,
            "prompt_version": self.prompt_version,
            "summary": self.summary(),
            "cases": [{**asdict(c), "score": c.score} for c in self.cases],
        }


def run_eval(
    eval_set: EvalSet,
    provider: LLMProvider,
    *,
    rag: RagRetriever | None = None,
    label: str | None = None,
    on_case=None,
) -> RunResult:
    gateway = LLMGateway(provider, rag=rag)
    results: list[CaseResult] = []
    prompt_version = ""
    for ec in eval_set.cases:
        case, findings = to_pipeline_inputs(ec)
        started = time.perf_counter()
        try:
            report = gateway.generate_draft(case, findings)
            res = score_report(ec, report, time.perf_counter() - started)
            prompt_version = report.generation.prompt_version or prompt_version
        except LLMProviderError as exc:
            res = CaseResult(
                case_id=ec.id,
                ok=False,
                latency_s=round(time.perf_counter() - started, 2),
                error=f"{exc.kind.value}: {exc}",
            )
        results.append(res)
        if on_case:
            on_case(res)
    return RunResult(
        label=label or provider.model_id,
        provider_id=provider.provider_id,
        model_id=provider.model_id,
        prompt_version=prompt_version,
        cases=results,
    )


METRIC_ROWS = (
    ("score", "Toplam skor (0–100)", "{:.1f}"),
    ("success_rate", "Başarılı üretim", "{:.0%}"),
    ("citation_coverage", "Kaynaklı cümle oranı", "{:.0%}"),
    ("finding_coverage", "Bulgu kapsama", "{:.0%}"),
    ("differential_recall", "Beklenen tanı yakalama", "{:.0%}"),
    ("must_mention_recall", "Zorunlu içerik", "{:.0%}"),
    ("overclaim_cases", "Aşırı iddialı vaka sayısı", "{:.0f}"),
    ("forbidden_cases", "Yasak ifade içeren vaka", "{:.0f}"),
    ("unknown_refs", "Geçersiz atıf sayısı", "{:.0f}"),
    ("blank_cases", "Bölüm boş bırakılan vaka", "{:.0f}"),
    ("english_ratio", "İngilizce kelime oranı", "{:.0%}"),
    ("latency_s", "Ortalama süre (sn)", "{:.1f}"),
)


def _fmt(value: Optional[float], pattern: str) -> str:
    return "—" if value is None else pattern.format(value)


def render_markdown(runs: list[RunResult], eval_set: EvalSet, *, title: str = "LLM değerlendirme sonuçları") -> str:
    lines = [f"# {title}", ""]
    lines.append(f"Set: **{eval_set.name}** (v{eval_set.version}, {len(eval_set.cases)} vaka)")
    if runs and runs[0].prompt_version:
        lines.append(f"Prompt: `{runs[0].prompt_version}`")
    lines += ["", "> Skorlar atıf, kapsama ve güvenlik davranışını ölçer; klinik doğruluk değildir.", ""]

    summaries = [r.summary() for r in runs]
    lines.append("| Metrik | " + " | ".join(f"`{r.label}`" for r in runs) + " |")
    lines.append("|---|" + "---|" * len(runs))
    for key, name, pattern in METRIC_ROWS:
        lines.append(f"| {name} | " + " | ".join(_fmt(s[key], pattern) for s in summaries) + " |")

    lines += ["", "## Vaka bazında skor", ""]
    lines.append("| Vaka | " + " | ".join(f"`{r.label}`" for r in runs) + " |")
    lines.append("|---|" + "---|" * len(runs))
    for i, ec in enumerate(eval_set.cases):
        cells = []
        for r in runs:
            c = r.cases[i]
            note = "" if c.ok else " ⚠️ hata"
            if c.ok and (c.forbidden_hits or c.overclaims):
                note = " ⚠️"
            cells.append(f"{_fmt(c.score, '{:.0f}')}{note}")
        lines.append(f"| {ec.id} — {ec.title} | " + " | ".join(cells) + " |")

    issues = [
        (r.label, ec.id, c)
        for r in runs
        for ec, c in zip(eval_set.cases, r.cases)
        if not c.ok or c.forbidden_hits or c.overclaims or c.unknown_refs or c.blank_sections
    ]
    if issues:
        lines += ["", "## Dikkat gerektirenler", ""]
        for label, case_id, c in issues:
            detail = c.error or "; ".join(
                [f"yasak: {', '.join(c.forbidden_hits)}"] * bool(c.forbidden_hits)
                + [f"aşırı iddia: {', '.join(c.overclaims)}"] * bool(c.overclaims)
                + [f"geçersiz atıf: {c.unknown_refs}"] * bool(c.unknown_refs)
                + [f"boş bölüm: {', '.join(c.blank_sections)}"] * bool(c.blank_sections)
            )
            lines.append(f"- `{label}` · {case_id}: {detail}")

    if runs:
        lines += ["", "## Örnek çıktılar (ilk vaka)", ""]
        for r in runs:
            c = r.cases[0]
            lines.append(f"### `{r.label}` — {c.case_id}")
            if not c.ok:
                lines.append(f"Hata: {c.error}")
                continue
            for k in ("findings", "impression"):
                lines.append(f"**{k}:** {c.sections.get(k, '')}")
                lines.append("")
    return "\n".join(lines) + "\n"
