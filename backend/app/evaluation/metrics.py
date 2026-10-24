"""Offline report metrics for development and labeled evaluation data.

These heuristic metrics are not clinical validation and must not be used to approve
reports or guide patient care.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.schemas.case import CaseRecord
    from app.schemas.findings import StructuredFindings
    from app.schemas.model_outputs import BoundingBox2D
    from app.schemas.report import DraftReport


@dataclass(frozen=True)
class BoundingBox:
    """Axis-aligned image box in pixel coordinates."""

    x1: float
    y1: float
    x2: float
    y2: float

    def __post_init__(self) -> None:
        coordinates = (self.x1, self.y1, self.x2, self.y2)
        if not all(math.isfinite(value) for value in coordinates):
            raise ValueError("Bounding box coordinates must be finite.")
        if self.x1 > self.x2 or self.y1 > self.y2:
            raise ValueError("Bounding box minimum coordinates must not exceed maximums.")

    @property
    def area(self) -> float:
        return (self.x2 - self.x1) * (self.y2 - self.y1)

    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2.0, (self.y1 + self.y2) / 2.0)

    @classmethod
    def from_model_output(cls, box: BoundingBox2D) -> BoundingBox:
        """Adapt the project's pixel-coordinate detection box."""
        return cls(box.x_min, box.y_min, box.x_max, box.y_max)


@dataclass(frozen=True)
class AnatomicalFinding:
    """Labeled finding used by evaluation, not an application diagnosis."""

    finding_name: str
    confidence: float | None = None
    bbox: BoundingBox | None = None
    is_bilateral: bool = False
    affected_side: str | None = None

    def __post_init__(self) -> None:
        if self.confidence is not None and (
            not math.isfinite(self.confidence) or not 0.0 <= self.confidence <= 1.0
        ):
            raise ValueError("Finding confidence must be in [0, 1] when present.")
        if self.affected_side not in {None, "left", "right", "both"}:
            raise ValueError("affected_side must be 'left', 'right', 'both', or None.")


@dataclass
class RadiologyReportPayload:
    """Evaluation payload for model output or ground truth."""

    patient_breed: str
    skull_morphotype: str
    findings: list[AnatomicalFinding]
    full_report_text: str
    missing_projections: list[str] = field(default_factory=list)

    @classmethod
    def from_project(
        cls,
        *,
        case: CaseRecord,
        findings: StructuredFindings,
        report: DraftReport | None = None,
        skull_morphotype: str = "",
    ) -> RadiologyReportPayload:
        """Adapt the project's case, findings, and report contracts for evaluation."""
        if case.case_id != findings.case_id:
            raise ValueError("Case and structured findings must have the same case_id.")

        finding_items = [
            AnatomicalFinding(
                finding_name=item.description,
                confidence=item.model_confidence,
            )
            for item in findings.findings
        ]
        report_text = ""
        if report is not None:
            if report.case_id != case.case_id:
                raise ValueError("Case and draft report must have the same case_id.")
            report_text = "\n".join(
                section.text
                for section in (
                    report.technique,
                    report.findings,
                    report.impression,
                    report.recommendations,
                )
            )

        return cls(
            patient_breed=case.breed or "",
            skull_morphotype=skull_morphotype,
            findings=finding_items,
            full_report_text=report_text,
        )


@dataclass(frozen=True)
class ConfusionMatrixStats:
    true_positive: int = 0
    false_positive: int = 0
    true_negative: int = 0
    false_negative: int = 0

    def __post_init__(self) -> None:
        for name, value in (
            ("true_positive", self.true_positive),
            ("false_positive", self.false_positive),
            ("true_negative", self.true_negative),
            ("false_negative", self.false_negative),
        ):
            if type(value) is not int or value < 0:
                raise ValueError(f"{name} must be a non-negative integer.")


@dataclass(frozen=True)
class MetricEvaluationResult:
    sensitivity: float
    specificity: float
    ppv: float
    npv: float
    f1_score: float
    f2_score: float
    mcc: float
    sensitivity_ci_lower: float
    sensitivity_ci_upper: float
    precision_ci_lower: float
    precision_ci_upper: float


@dataclass(frozen=True)
class HallucinationPenaltyReport:
    mhi_score: float
    critical_pitfalls_detected: int
    minor_hallucinations_detected: int
    penalty_details: list[str]


class ClinicalClassificationMetrics:
    """Classification metrics and Wilson score intervals for labeled cases."""

    def __init__(self, z_score_95: float = 1.96) -> None:
        if not math.isfinite(z_score_95) or z_score_95 <= 0.0:
            raise ValueError("z_score_95 must be a positive finite number.")
        self.z = z_score_95

    @staticmethod
    def _safe_divide(numerator: float, denominator: float) -> float:
        return float(numerator) / float(denominator) if denominator else 0.0

    def calculate_wilson_score_interval(self, p: float, n: int) -> tuple[float, float]:
        """Return the Wilson interval for a proportion and its trial count."""
        if not math.isfinite(p) or not 0.0 <= p <= 1.0:
            raise ValueError("p must be a finite proportion in [0, 1].")
        if type(n) is not int or n < 0:
            raise ValueError("n must be a non-negative integer.")
        if n == 0:
            return (0.0, 0.0)

        z_squared = self.z**2
        denominator = 1.0 + z_squared / n
        center = p + z_squared / (2.0 * n)
        variance = (p * (1.0 - p) / n) + (z_squared / (4.0 * n**2))
        margin = self.z * math.sqrt(max(0.0, variance))
        return (
            max(0.0, (center - margin) / denominator),
            min(1.0, (center + margin) / denominator),
        )

    def evaluate_class_metrics(self, stats: ConfusionMatrixStats) -> MetricEvaluationResult:
        tp, fp, tn, fn = (
            stats.true_positive,
            stats.false_positive,
            stats.true_negative,
            stats.false_negative,
        )
        actual_positives = tp + fn
        actual_negatives = tn + fp
        predicted_positives = tp + fp
        predicted_negatives = tn + fn

        sensitivity = self._safe_divide(tp, actual_positives)
        specificity = self._safe_divide(tn, actual_negatives)
        ppv = self._safe_divide(tp, predicted_positives)
        npv = self._safe_divide(tn, predicted_negatives)
        f1_score = self._safe_divide(2 * tp, 2 * tp + fp + fn)
        f2_score = self._safe_divide(5.0 * ppv * sensitivity, 4.0 * ppv + sensitivity)

        mcc_denominator = math.sqrt(
            float(
                (tp + fp)
                * (tp + fn)
                * (tn + fp)
                * (tn + fn)
            )
        )
        mcc = self._safe_divide((tp * tn) - (fp * fn), mcc_denominator)

        sensitivity_ci = self.calculate_wilson_score_interval(sensitivity, actual_positives)
        precision_ci = self.calculate_wilson_score_interval(ppv, predicted_positives)
        return MetricEvaluationResult(
            sensitivity=sensitivity,
            specificity=specificity,
            ppv=ppv,
            npv=npv,
            f1_score=f1_score,
            f2_score=f2_score,
            mcc=mcc,
            sensitivity_ci_lower=sensitivity_ci[0],
            sensitivity_ci_upper=sensitivity_ci[1],
            precision_ci_lower=precision_ci[0],
            precision_ci_upper=precision_ci[1],
        )


def _normalize_text(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    ascii_text = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9]+", ascii_text))


def _contains_phrase(text: str, phrase: str) -> bool:
    normalized_text = _normalize_text(text)
    normalized_phrase = _normalize_text(phrase)
    return bool(normalized_phrase) and f" {normalized_phrase} " in f" {normalized_text} "


class MedicalHallucinationDetector:
    """Heuristic comparison against labeled findings; not a clinical safety gate."""

    def __init__(self) -> None:
        self.critical_pitfalls = (
            {
                "name": "Persistent open fontanel misread as fracture",
                "breeds": (
                    "chihuahua",
                    "pomeranian",
                    "yorkshire terrier",
                    "maltese",
                    "pug",
                    "pekingese",
                ),
                "morphotypes": (),
                "predicted_terms": (
                    "calvarium fracture",
                    "skull fracture",
                    "cranial fracture",
                    "cranial defect",
                ),
            },
            {
                "name": "Brachycephalic bulla morphology misread as ear disease",
                "breeds": ("pug", "bulldog", "french bulldog", "english bulldog", "persian"),
                "morphotypes": ("brachycephalic",),
                "predicted_terms": (
                    "otitis media",
                    "tympanic bulla sclerosis",
                    "middle ear disease",
                ),
            },
            {
                "name": "Normal mandibular symphysis misread as fracture",
                "breeds": ("yorkshire terrier",),
                "morphotypes": (),
                "predicted_terms": (
                    "mandibular symphyseal fracture",
                    "symphysis fracture",
                ),
            },
        )

    @staticmethod
    def normalize_string(text: str) -> str:
        return _normalize_text(text)

    def check_pitfall(
        self,
        breed: str,
        morphotype: str,
        predicted_findings: list[AnatomicalFinding],
        ground_truth_findings: list[AnatomicalFinding],
    ) -> tuple[list[str], set[int]]:
        penalties: list[str] = []
        critical_prediction_indices: set[int] = set()
        normalized_breed = _normalize_text(breed)
        normalized_morphotype = _normalize_text(morphotype)

        for pitfall in self.critical_pitfalls:
            breed_matches = any(
                _contains_phrase(normalized_breed, term) for term in pitfall["breeds"]
            )
            morphotype_matches = any(
                _contains_phrase(normalized_morphotype, term)
                for term in pitfall["morphotypes"]
            )
            if not breed_matches and not morphotype_matches:
                continue

            matches = {
                index
                for index, finding in enumerate(predicted_findings)
                if any(
                    _contains_phrase(finding.finding_name, term)
                    for term in pitfall["predicted_terms"]
                )
            }
            if not matches:
                continue

            confirmed = any(
                any(
                    _contains_phrase(finding.finding_name, term)
                    for term in pitfall["predicted_terms"]
                )
                for finding in ground_truth_findings
            )
            if not confirmed:
                critical_prediction_indices.update(matches)
                penalties.append(
                    f"CRITICAL PITFALL: {pitfall['name']} in {breed or morphotype}."
                )

        return penalties, critical_prediction_indices

    def calculate_mhi(
        self,
        predicted: RadiologyReportPayload,
        truth: RadiologyReportPayload,
    ) -> HallucinationPenaltyReport:
        penalty_details, critical_indices = self.check_pitfall(
            predicted.patient_breed,
            predicted.skull_morphotype,
            predicted.findings,
            truth.findings,
        )
        critical_count = len(penalty_details)
        ground_truth_names = {
            _normalize_text(finding.finding_name) for finding in truth.findings
        }

        minor_count = 0
        for index, finding in enumerate(predicted.findings):
            normalized_name = _normalize_text(finding.finding_name)
            if index in critical_indices or normalized_name in ground_truth_names:
                continue
            minor_count += 1
            penalty_details.append(
                f"MINOR HALLUCINATION: Unverified finding -> '{finding.finding_name}'"
            )

        score = max(0.0, 100.0 - (critical_count * 25.0) - (minor_count * 5.0))
        return HallucinationPenaltyReport(
            mhi_score=score,
            critical_pitfalls_detected=critical_count,
            minor_hallucinations_detected=minor_count,
            penalty_details=penalty_details,
        )


class SpatialAndSymmetryEvaluator:
    """Pairwise box-overlap, center-distance, and finding-laterality metrics."""

    @staticmethod
    def calculate_intersection_area(box_a: BoundingBox, box_b: BoundingBox) -> float:
        width = max(0.0, min(box_a.x2, box_b.x2) - max(box_a.x1, box_b.x1))
        height = max(0.0, min(box_a.y2, box_b.y2) - max(box_a.y1, box_b.y1))
        return width * height

    def calculate_iou(self, box_a: BoundingBox, box_b: BoundingBox) -> float:
        intersection = self.calculate_intersection_area(box_a, box_b)
        union = box_a.area + box_b.area - intersection
        return intersection / union if union > 0.0 else 0.0

    def calculate_giou(self, box_a: BoundingBox, box_b: BoundingBox) -> float:
        iou = self.calculate_iou(box_a, box_b)
        enclosing_area = (
            max(box_a.x2, box_b.x2) - min(box_a.x1, box_b.x1)
        ) * (max(box_a.y2, box_b.y2) - min(box_a.y1, box_b.y1))
        if enclosing_area <= 0.0:
            return 0.0
        intersection = self.calculate_intersection_area(box_a, box_b)
        union = box_a.area + box_b.area - intersection
        return float(iou - ((enclosing_area - union) / enclosing_area))

    def calculate_dsc(self, box_a: BoundingBox, box_b: BoundingBox) -> float:
        total_area = box_a.area + box_b.area
        if total_area <= 0.0:
            return 0.0
        return 2.0 * self.calculate_intersection_area(box_a, box_b) / total_area

    @staticmethod
    def calculate_euclidean_distance(box_a: BoundingBox, box_b: BoundingBox) -> float:
        center_a = box_a.center()
        center_b = box_b.center()
        return math.dist(center_a, center_b)

    @staticmethod
    def calculate_laterality_accuracy(
        predicted: AnatomicalFinding,
        truth: AnatomicalFinding,
    ) -> float:
        predicted_side = "both" if predicted.is_bilateral else predicted.affected_side
        truth_side = "both" if truth.is_bilateral else truth.affected_side
        return float(predicted_side is not None and predicted_side == truth_side)


class TemplateAdherenceEvaluator:
    """Checks project report sections and a lightweight terminology frequency."""

    section_labels = {
        "technique": ("Technique", "Radiographic Technique", "Teknik"),
        "findings": ("Findings", "Bulgular"),
        "impression": ("Impression", "Radiographic Impression", "İzlenim"),
        "recommendations": ("Recommendations", "Öneriler"),
    }
    nav_terminology = frozenset(
        {
            "rostral",
            "caudal",
            "dorsal",
            "ventral",
            "radiolucent",
            "radiopaque",
            "sclerosis",
            "lysis",
            "osteophyte",
            "subluxation",
            "symphysis",
            "tympanic",
            "bulla",
            "zygomatic",
            "arch",
            "sagittal",
            "crest",
            "foramen",
            "magnum",
            "occipital",
        }
    )

    def evaluate_structural_integrity(
        self,
        report: str | DraftReport,
    ) -> dict[str, float | list[str] | bool]:
        if isinstance(report, str):
            report_sections = self._find_text_sections(report)
        else:
            report_sections = {
                name: bool(getattr(report, name).text.strip()) for name in self.section_labels
            }

        missing_sections = [
            self.section_labels[name][0]
            for name, present in report_sections.items()
            if not present
        ]
        completion_ratio = (
            (len(self.section_labels) - len(missing_sections)) / len(self.section_labels)
        )
        return {
            "template_completion_ratio": round(completion_ratio * 100.0, 2),
            "missing_sections": missing_sections,
            "is_valid_structure": completion_ratio >= 0.85,
        }

    def _find_text_sections(self, report_text: str) -> dict[str, bool]:
        found: dict[str, bool] = {}
        for key, labels in self.section_labels.items():
            alternatives = "|".join(re.escape(label) for label in labels)
            pattern = re.compile(
                rf"(?im)^\s*(?:\#{{1,6}}\s*)?(?:{alternatives})\s*:\s*\S"
            )
            found[key] = bool(pattern.search(report_text))
        return found

    def calculate_terminology_density(self, report_text: str) -> float:
        words = re.findall(r"\b\w+\b", report_text.casefold(), flags=re.UNICODE)
        if not words:
            return 0.0
        terms = sum(word in self.nav_terminology for word in words)
        return round((terms / len(words)) * 100.0, 2)
