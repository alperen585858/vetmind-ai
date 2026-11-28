"""Live AI architecture diagram for the admin page.

Every box's state is read from the running container (settings, model registry, router,
RAG embedding status) and from recent analysis jobs, so the diagram changes when the
configuration or the traffic changes. Nothing here calls a model.

Single source of truth: the admin page and docs/AI_MIMARISI.md (scripts/generate_architecture_doc.py)
are both built here. The analysis part follows ``PIPELINE_STAGES`` and the router branches follow
``Modality``, so a stage or modality added in code appears in the diagram without editing this file;
tests/test_architecture_status.py fails when a stage has no box or a box points to a missing file.

Status values:
  active   — real component running (or a non-AI step that always runs)
  mock     — mock / synthetic output
  fallback — running, but not what was asked for (e.g. bge-m3 requested, hash active)
  off      — not configured / disabled
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from app.orchestration.progress import PIPELINE_STAGES, stage_label_tr
from app.routing.capabilities import (
    AVAILABILITY_NOT_CONFIGURED,
    AVAILABILITY_SYNTHETIC,
    ModelCapability,
)
from app.routing.execution_policy import VisionExecutionMode
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    Modality,
    SourceKind,
)

log = logging.getLogger(__name__)

ACTIVE = "active"
MOCK = "mock"
FALLBACK = "fallback"
OFF = "off"

# Router branches: one per Modality value, so a new modality shows up as a new branch.
# Only the display names live here; unknown modalities fall back to their enum value.
BRANCH_IDS: dict[Modality, str] = {
    Modality.XR: "xray",
    Modality.CT: "ct",
    Modality.MR: "mri",
    Modality.OTHER: "document",
}
BRANCH_LABELS: dict[Modality, str] = {
    Modality.XR: "X-Ray",
    Modality.CT: "CT",
    Modality.MR: "MRI",
    Modality.OTHER: "Görüntü + Metin",
}
BRANCH_TITLES: dict[Modality, str] = {
    Modality.XR: "X-Ray Vision Modeli",
    Modality.CT: "CT 3D Modeli",
    Modality.MR: "MRI Modeli",
    Modality.OTHER: "Multimodal VLM",
}

RECENT_CASES = 50


def _node(
    node_id: str,
    label: str,
    status: str,
    detail: str = "",
    *,
    info: dict[str, Any] | None = None,
    branch_label: str | None = None,
    code: tuple[str, ...] = (),
    doc_detail: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": node_id,
        "label": label,
        "status": status,
        "detail": detail,
        "info": info or {},
        # Repo-relative files behind this box (checked by tests, listed in docs/AI_MIMARISI.md).
        "code": list(code),
    }
    if branch_label:
        out["branch_label"] = branch_label
    # Detail without live counts, for the generated Mermaid doc (keeps it deterministic).
    if doc_detail is not None:
        out["doc_detail"] = doc_detail
    return out


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _when(iso: str | None) -> str:
    """Readable local time for the details panel, e.g. 25.11.2026 18:56."""
    if not iso:
        return ""
    return datetime.fromisoformat(iso).astimezone().strftime("%d.%m.%Y %H:%M")


def _routable(cap: ModelCapability, modality: Modality) -> bool:
    return (
        cap.enabled
        and cap.availability != AVAILABILITY_NOT_CONFIGURED
        and modality in cap.modalities
        and cap.adapter_kind not in {"synthetic", "manual"}
    )


def models_for_modality(
    capabilities: list[ModelCapability],
    modality: Modality,
    mode: VisionExecutionMode,
) -> list[ModelCapability]:
    """Models the router would run for this modality, after the REAL/MOCK execution policy.

    Same rule as ModelExecutionPolicy: in exclusive_real mode a matching real model
    replaces the mocks of the same anatomy. Checked per region, then merged.
    """
    picked: dict[str, ModelCapability] = {}
    for region in AnatomicalRegion:
        matches = [c for c in capabilities if _routable(c, modality) and region in c.regions]
        if not matches:
            continue
        real = [c for c in matches if c.source_kind == SourceKind.REAL]
        if mode == VisionExecutionMode.EXCLUSIVE_REAL and real:
            matches = real
        for c in sorted(matches, key=lambda c: (c.priority, c.model_id)):
            picked.setdefault(c.model_id, c)
    return list(picked.values())


def _recent_usage(container: Any) -> dict[str, Any]:
    """Counts from the latest analysis jobs and drafts (most recently updated cases)."""
    model_uses: Counter[str] = Counter()
    modality_uses: Counter[str] = Counter()
    model_last: dict[str, datetime] = {}
    llm_last: dict[str, Any] | None = None
    awaiting_review = 0
    approved = 0
    jobs_seen = 0
    try:
        cases = list(container.repo.list_cases())
    except Exception:  # noqa: BLE001 — diagram must render even if storage hiccups
        log.warning("Could not list cases for architecture status", exc_info=True)
        cases = []
    cases.sort(key=lambda c: c.updated_at, reverse=True)
    for case in cases:
        if case.status in (CaseLifecycleStatus.AWAITING_REVIEW, CaseLifecycleStatus.MANUAL_REVIEW):
            awaiting_review += 1
        elif case.status == CaseLifecycleStatus.APPROVED:
            approved += 1
    for case in cases[:RECENT_CASES]:
        if case.latest_job_id:
            job = container.repo.get_job(case.latest_job_id)
            if job is not None:
                jobs_seen += 1
                if job.routed_model_ids:
                    modality_uses[case.modality.value] += 1
                when = job.completed_at or job.started_at
                for mid in job.routed_model_ids:
                    model_uses[mid] += 1
                    if when and (mid not in model_last or when > model_last[mid]):
                        model_last[mid] = when
        draft = case.draft_report
        if draft is not None:
            gen = draft.generation
            if llm_last is None or gen.generated_at > llm_last["_at"]:
                llm_last = {
                    "_at": gen.generated_at,
                    "provider_id": gen.provider_id,
                    "model_id": gen.model_id,
                    "source_kind": getattr(gen.source_kind, "value", str(gen.source_kind)),
                }
    if llm_last is not None:
        llm_last["generated_at"] = _iso(llm_last.pop("_at"))
    return {
        "jobs_seen": jobs_seen,
        "model_uses": dict(model_uses),
        "modality_uses": dict(modality_uses),
        "model_last": {k: _iso(v) for k, v in model_last.items()},
        "llm_last": llm_last,
        "awaiting_review": awaiting_review,
        "approved": approved,
    }


def _intake_rows(container: Any, s: Any, llm_is_mock: bool) -> list[list[dict[str, Any]]]:
    """Upload → case. Runs before the analysis job, so it is not in PIPELINE_STAGES."""
    scanner_cls = type(getattr(container, "malware_scanner", None)).__name__
    scan_on = scanner_cls not in {"NoopScanner", "NoneType"}
    ocr = bool(getattr(s, "document_ocr_endpoint", None))
    cls_llm = bool(getattr(s, "classifier_llm", False)) and not llm_is_mock
    return [
        [_node("upload", "Dosya Yükleme", ACTIVE, "DICOM · PDF · JPG · PNG · TXT",
               code=("backend/app/api/dicom.py", "backend/app/api/documents.py"))],
        [_node("quarantine", "Karantina", ACTIVE,
               "SHA256 + manifest · virüs taraması " + ("açık" if scan_on else "kapalı"),
               info={"Virüs tarayıcı": scanner_cls if scan_on else "yok"},
               code=("backend/app/storage/quarantine.py", "backend/app/storage/malware_scan.py",
                     "backend/app/ingest/filetype.py"))],
        [
            _node("dicom_parser", "DICOM Okuyucu", ACTIVE, "pydicom · Study → Series → Instance",
                  code=("backend/app/dicom/parser.py", "backend/app/dicom/validator.py",
                        "backend/app/dicom/ingest.py")),
            _node("doc_parser", "Doküman Okuyucu", ACTIVE,
                  "OCR servisi" if ocr else "Metin çıkarma (OCR yok)",
                  code=("backend/app/ingest/documents.py",)),
        ],
        [_node("classifier", "Tür / Modalite / Bölge Sınıflandırma", ACTIVE,
               "Kurallar + LLM" if cls_llm else "Yalnızca kurallar",
               info={"LLM desteği": (s.classifier_llm_model_id or s.llm_model_id) if cls_llm else "kapalı"},
               code=("backend/app/dicom/classifier.py", "backend/app/dicom/llm_classifier.py"))],
        [_node("confirm", "Kullanıcı Onayı", ACTIVE, "Sınıflandırma onaylanınca vaka açılır",
               code=("backend/app/services/dicom_service.py",))],
    ]


def _branch_nodes(container: Any, s: Any, usage: dict[str, Any]) -> list[dict[str, Any]]:
    mode = container.execution_policy.mode
    caps = container.router.list_capabilities()
    nodes: list[dict[str, Any]] = []
    for modality in Modality:
        node_id = BRANCH_IDS.get(modality, modality.value.lower())
        branch_label = BRANCH_LABELS.get(modality, modality.value)
        chosen = models_for_modality(caps, modality, mode)
        code = ("backend/app/models/mock_vision.py", "backend/app/models/local_torch.py",
                "backend/app/models/vlm_vision.py", "backend/app/models/http_vision.py")
        # Tiny CT/MR contract models are registered but never routed: list them as mock.
        probes = {
            c.model_id: f"tiny sözleşme modeli (mock) · v{c.model_version} · analize alınmaz"
            for c in caps
            if c.adapter_kind == "local_torch"
            and c.availability == AVAILABILITY_SYNTHETIC
            and modality in c.modalities
        }
        if not chosen:
            nodes.append(_node(node_id, "Manuel inceleme", OFF, "Bu tetkik için model yok",
                               info=probes or None, branch_label=branch_label, code=code))
            continue
        kinds = {c.source_kind for c in chosen}
        names = [c.model_id for c in chosen]
        info: dict[str, Any] = {}
        for c in chosen:
            kind = "gerçek" if c.source_kind == SourceKind.REAL else "mock"
            last = usage["model_last"].get(c.model_id)
            info[c.model_id] = f"{kind} · v{c.model_version}" + (f" · son kullanım {_when(last)}" if last else "")
        info.update(probes)
        vlm = any(c.adapter_kind == "vlm" for c in chosen)
        if vlm:
            info["VLM modeli"] = getattr(s, "vlm_chat_model_id", None) or s.llm_model_id
        title = "Multimodal VLM" if vlm else BRANCH_TITLES.get(modality, f"{modality.value} Modeli")
        detail = names[0] if len(names) == 1 else f"{names[0]} +{len(names) - 1}"
        node = _node(node_id, title, ACTIVE if SourceKind.REAL in kinds else MOCK, detail,
                     info=info, branch_label=branch_label, code=code)
        node["recent_uses"] = usage["modality_uses"].get(modality.value, 0)
        nodes.append(node)
    return nodes


def _stage_rows(stage: str, container: Any, s: Any, usage: dict[str, Any], llm_is_mock: bool) -> list[list[dict[str, Any]]]:
    """Diagram rows for one analysis pipeline stage (orchestration/progress.py)."""
    if stage == "queued":
        return []
    if stage == "prep_metadata":
        return [[_node("model_input", "Model Girdisi Hazırlama", ACTIVE,
                       "Seri seçimi · görüntü kalitesi · piksel izni",
                       info={"Piksel analizi izni": "açık" if getattr(s, "pixel_analysis_opt_in", False) else "kapalı"},
                       code=("backend/app/models/model_input_builder.py", "backend/app/imaging/series_selection.py",
                             "backend/app/imaging/quality.py", "backend/app/models/pixel_authorization.py"))]]
    if stage == "route_models":
        mode = container.execution_policy.mode
        return [[_node("router", "AI Model Router", ACTIVE,
                       "Yalnızca gerçek modeller öncelikli" if mode == VisionExecutionMode.EXCLUSIVE_REAL
                       else "Gerçek + mock birlikte",
                       info={"Yürütme politikası": mode.value},
                       code=("backend/app/routing/model_router.py", "backend/app/routing/scenario_policy.py",
                             "backend/app/routing/execution_policy.py", "backend/app/routing/capabilities.py"))]]
    if stage == "vision_adapters":
        return [_branch_nodes(container, s, usage)]
    if stage == "normalize_findings":
        return [[_node("findings", "Yapılandırılmış Bulgular + Kanıt", ACTIVE,
                       "Normalize · birleştirme · kanıt görüntüleri",
                       code=("backend/app/models/normalizer.py", "backend/app/models/evidence_attach.py"))]]
    if stage == "llm_draft":
        emb = container.rag_embedding.as_dict() if getattr(container, "rag_embedding", None) else None
        store = container.vector_store.kind if getattr(container, "vector_store", None) is not None else None
        rag_code = ("backend/app/rag/retriever.py", "backend/app/rag/relevance.py",
                    "backend/app/rag/pgvector_store.py", "backend/app/rag/ollama_embeddings.py")
        if getattr(container, "rag", None) is None:
            rag = _node("rag", "RAG Bilgi Bankası", OFF, "Kapalı", code=rag_code)
        else:
            e = emb or {}
            emb_name = e.get("model") if e.get("active") == "ollama" else "hash"
            rag = _node("rag", "RAG Bilgi Bankası", FALLBACK if e.get("fell_back") else ACTIVE,
                        f"{emb_name or container.rag_method} · {store or 'bellek'}",
                        info={"İstenen embedding": e.get("requested") or container.rag_method,
                              "Çalışan embedding": e.get("active") or container.rag_method,
                              "Uyarı": e.get("warning") or "—"},
                        code=rag_code)
        llm_last = usage["llm_last"]
        llm = _node("llm", "Rapor LLM", MOCK if llm_is_mock else ACTIVE,
                    "Şablon (mock)" if llm_is_mock else f"{s.llm_provider} · {s.llm_model_id}",
                    info={"Sağlayıcı": s.llm_provider,
                          "Model": s.llm_model_id,
                          "Hakem (doğrulayıcı)": (s.llm_verifier_model_id or s.llm_model_id) if s.llm_verify else "kapalı",
                          "Son taslak": (f"{llm_last['provider_id']} · {llm_last['model_id']} · "
                                         f"{_when(llm_last['generated_at'])}" if llm_last else "henüz yok")},
                    code=("backend/app/llm/factory.py", "backend/app/llm/chat_providers.py",
                          "backend/app/llm/verifier.py"))
        gateway = _node("gateway", "LLM Gateway", ACTIVE,
                        "KVKK maskeleme · prompt-injection temizleme · uzman dersleri",
                        code=("backend/app/llm/gateway.py", "backend/app/llm/privacy.py", "backend/app/llm/lessons.py"))
        return [[gateway, rag], [llm]]
    if stage == "validate_report":
        return [[_node("validation", "Rapor Doğrulama", ACTIVE, "ReportValidator + atıf kontrolü",
                       code=("backend/app/validation/report_validator.py", "backend/app/llm/grounding.py"))]]
    if stage == "finalize":
        return [
            [_node("review", "Veteriner Radyolog İncelemesi", ACTIVE,
                   f"{usage['awaiting_review']} vaka inceleme bekliyor",
                   doc_detail="Onay · red · revizyon",
                   code=("backend/app/services/workflow_service.py", "backend/app/services/report_versioning.py"))],
            [_node("approved", "Onaylı Rapor", ACTIVE, f"{usage['approved']} onaylı rapor",
                   doc_detail="Değişmez sürüm → PDF",
                   code=("backend/app/services/pdf_report.py",))],
        ]
    # A stage added to PIPELINE_STAGES without a dedicated box still shows up.
    return [[_node(f"stage_{stage}", stage_label_tr(stage), ACTIVE, "Yeni pipeline adımı",
                   code=("backend/app/orchestration/orchestrator.py",))]]


# Stages with a dedicated box above; tests check PIPELINE_STAGES against this set.
KNOWN_STAGES = frozenset({
    "queued", "prep_metadata", "route_models", "vision_adapters",
    "normalize_findings", "llm_draft", "validate_report", "finalize",
})


def build_architecture(container: Any) -> dict[str, Any]:
    s = container.settings
    usage = _recent_usage(container)
    llm_is_mock = (s.llm_provider or "mock").strip().lower() in {"mock", "stub", "deterministic"}

    rows = _intake_rows(container, s, llm_is_mock)
    for stage in PIPELINE_STAGES:
        rows.extend(_stage_rows(stage, container, s, usage, llm_is_mock))

    all_nodes = [n for row in rows for n in row]
    ai_nodes = {n["id"] for n in all_nodes if n.get("branch_label")} | {"rag", "llm"}
    return {
        "generated_at": _iso(datetime.now(timezone.utc)),
        "rows": [[n["id"] for n in row] for row in rows],
        # Nodes drawn beside the main flow with a dashed arrow, not as a branch.
        "side_nodes": ["rag"],
        "nodes": {n["id"]: n for n in all_nodes},
        "summary": {
            "real": sum(1 for n in all_nodes if n["status"] == ACTIVE and n["id"] in ai_nodes),
            "mock": sum(1 for n in all_nodes if n["status"] == MOCK),
            "fallback": sum(1 for n in all_nodes if n["status"] == FALLBACK),
            "off": sum(1 for n in all_nodes if n["status"] == OFF),
            "recent_jobs": usage["jobs_seen"],
        },
    }


# --- Mermaid ---------------------------------------------------------------

_MERMAID_CLASSES = {
    ACTIVE: "fill:#0b2a4a,stroke:#34d399,color:#cfe3ff,stroke-width:2px",
    MOCK: "fill:#0b2a4a,stroke:#fbbf24,color:#cfe3ff,stroke-width:2px",
    FALLBACK: "fill:#0b2a4a,stroke:#f97316,color:#cfe3ff,stroke-width:2px",
    OFF: "fill:#0a1e33,stroke:#64748b,color:#8fb3d9,stroke-dasharray:4 4",
}


def _mm(text: str) -> str:
    return text.replace('"', "'")


def to_mermaid(arch: dict[str, Any]) -> str:
    """Mermaid flowchart of ``build_architecture`` output (no live counts or times)."""
    nodes = arch["nodes"]
    side = set(arch.get("side_nodes", []))
    lines = ["flowchart TD"]
    for node_id, n in nodes.items():
        detail = n.get("doc_detail", n["detail"])
        body = _mm(n["label"]) + (f"<br/>{_mm(detail)}" if detail else "")
        lines.append(f'    {node_id}("{body}")')
    prev: list[str] = []
    for row in arch["rows"]:
        main = [i for i in row if i not in side]
        for i in row:
            if i in side:
                for m in main:
                    lines.append(f"    {i} -.-> {m}")
        for p in prev:
            for m in main:
                branch = nodes[m].get("branch_label")
                if branch and len(prev) == 1:
                    lines.append(f'    {p} -->|"{_mm(branch)}"| {m}')
                elif len(prev) == 1 or len(main) == 1:
                    lines.append(f"    {p} --> {m}")
        prev = main
    for status, style in _MERMAID_CLASSES.items():
        lines.append(f"    classDef {status} {style};")
    for status in _MERMAID_CLASSES:
        ids = [i for i, n in nodes.items() if n["status"] == status]
        if ids:
            lines.append(f"    class {','.join(ids)} {status};")
    return "\n".join(lines) + "\n"
