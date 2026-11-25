"""Live AI architecture diagram for the admin page.

Every box's state is read from the running container (settings, model registry, router,
RAG embedding status) and from recent analysis jobs, so the diagram changes when the
configuration or the traffic changes. Nothing here calls a model.

Status values:
  active   — real component running (or a non-AI step that always runs)
  mock     — mock / synthetic output
  fallback — running, but not what was asked for (e.g. bge-m3 requested, hash active)
  off      — not configured / disabled
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

from app.routing.capabilities import AVAILABILITY_NOT_CONFIGURED, ModelCapability
from app.routing.execution_policy import VisionExecutionMode
from app.schemas.enums import AnatomicalRegion, CaseLifecycleStatus, Modality, SourceKind

ACTIVE = "active"
MOCK = "mock"
FALLBACK = "fallback"
OFF = "off"

# Router branches shown in the diagram: (node id, label, modality).
BRANCHES: tuple[tuple[str, str, Modality], ...] = (
    ("xray", "X-Ray", Modality.XR),
    ("ct", "CT", Modality.CT),
    ("mri", "MRI", Modality.MR),
    ("document", "Görüntü + Metin", Modality.OTHER),
)

RECENT_CASES = 50


def _node(
    node_id: str,
    label: str,
    status: str,
    detail: str = "",
    *,
    info: dict[str, Any] | None = None,
    branch_label: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {"id": node_id, "label": label, "status": status, "detail": detail, "info": info or {}}
    if branch_label:
        out["branch_label"] = branch_label
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


def build_architecture(container: Any) -> dict[str, Any]:
    s = container.settings
    usage = _recent_usage(container)

    # --- intake -----------------------------------------------------------
    scanner_cls = type(getattr(container, "malware_scanner", None)).__name__
    scan_on = scanner_cls not in {"NoopScanner", "NoneType"}
    upload = _node(
        "upload",
        "Dosya Yükleme",
        ACTIVE,
        "DICOM · PDF · JPG · PNG · TXT",
    )
    quarantine = _node(
        "quarantine",
        "Karantina",
        ACTIVE,
        "SHA256 + manifest · virüs taraması " + ("açık" if scan_on else "kapalı"),
        info={"Virüs tarayıcı": scanner_cls if scan_on else "yok"},
    )
    dicom_parser = _node("dicom_parser", "DICOM Okuyucu", ACTIVE, "pydicom · Study → Series → Instance")
    ocr = bool(getattr(s, "document_ocr_endpoint", None))
    doc_parser = _node(
        "doc_parser",
        "Doküman Okuyucu",
        ACTIVE,
        "OCR servisi" if ocr else "Metin çıkarma (OCR yok)",
    )
    llm_kind = (s.llm_provider or "mock").strip().lower()
    llm_is_mock = llm_kind in {"mock", "stub", "deterministic"}
    cls_llm = bool(getattr(s, "classifier_llm", False)) and not llm_is_mock
    classifier = _node(
        "classifier",
        "Tür / Modalite / Bölge Sınıflandırma",
        ACTIVE,
        "Kurallar + LLM" if cls_llm else "Yalnızca kurallar",
        info={"LLM desteği": (s.classifier_llm_model_id or s.llm_model_id) if cls_llm else "kapalı"},
    )
    confirm = _node("confirm", "Kullanıcı Onayı", ACTIVE, "Sınıflandırma onaylanınca vaka açılır")

    # --- routing ----------------------------------------------------------
    mode = container.execution_policy.mode
    router = _node(
        "router",
        "AI Model Router",
        ACTIVE,
        "Yalnızca gerçek modeller öncelikli" if mode == VisionExecutionMode.EXCLUSIVE_REAL else "Gerçek + mock birlikte",
        info={"Yürütme politikası": mode.value},
    )
    caps = container.router.list_capabilities()
    branches: list[dict[str, Any]] = []
    for node_id, branch_label, modality in BRANCHES:
        chosen = models_for_modality(caps, modality, mode)
        if not chosen:
            branches.append(
                _node(node_id, "Manuel inceleme", OFF, "Bu tetkik için model yok", branch_label=branch_label)
            )
            continue
        kinds = {c.source_kind for c in chosen}
        status = ACTIVE if SourceKind.REAL in kinds else MOCK
        names = [c.model_id for c in chosen]
        uses = usage["modality_uses"].get(modality.value, 0)
        info: dict[str, Any] = {}
        for c in chosen:
            kind = "gerçek" if c.source_kind == SourceKind.REAL else "mock"
            last = usage["model_last"].get(c.model_id)
            info[c.model_id] = f"{kind} · v{c.model_version}" + (f" · son kullanım {_when(last)}" if last else "")
        if any(c.adapter_kind == "vlm" for c in chosen):
            info["VLM modeli"] = getattr(s, "vlm_chat_model_id", None) or s.llm_model_id
        detail = names[0] if len(names) == 1 else f"{names[0]} +{len(names) - 1}"
        node = _node(node_id, _branch_title(modality, chosen), status, detail, info=info, branch_label=branch_label)
        node["recent_uses"] = uses
        branches.append(node)

    findings = _node("findings", "Yapılandırılmış Bulgular + Kanıt", ACTIVE, "Normalize · birleştirme · kanıt görüntüleri")

    # --- report -----------------------------------------------------------
    emb = container.rag_embedding.as_dict() if getattr(container, "rag_embedding", None) else None
    store = container.vector_store.kind if getattr(container, "vector_store", None) is not None else None
    if getattr(container, "rag", None) is None:
        rag = _node("rag", "RAG Bilgi Bankası", OFF, "Kapalı")
    else:
        emb_name = (emb or {}).get("model") if (emb or {}).get("active") == "ollama" else "hash"
        rag_status = FALLBACK if (emb or {}).get("fell_back") else ACTIVE
        rag = _node(
            "rag",
            "RAG Bilgi Bankası",
            rag_status,
            f"{emb_name or container.rag_method} · {store or 'bellek'}",
            info={
                "İstenen embedding": (emb or {}).get("requested") or container.rag_method,
                "Çalışan embedding": (emb or {}).get("active") or container.rag_method,
                "Uyarı": (emb or {}).get("warning") or "—",
            },
        )
    gateway = _node("gateway", "LLM Gateway", ACTIVE, "KVKK maskeleme · prompt-injection temizleme · uzman dersleri")
    llm_last = usage["llm_last"]
    llm = _node(
        "llm",
        "Rapor LLM",
        MOCK if llm_is_mock else ACTIVE,
        "Şablon (mock)" if llm_is_mock else f"{s.llm_provider} · {s.llm_model_id}",
        info={
            "Sağlayıcı": s.llm_provider,
            "Model": s.llm_model_id,
            "Hakem (doğrulayıcı)": (s.llm_verifier_model_id or s.llm_model_id) if s.llm_verify else "kapalı",
            "Son taslak": (
                f"{llm_last['provider_id']} · {llm_last['model_id']} · {_when(llm_last['generated_at'])}" if llm_last else "henüz yok"
            ),
        },
    )
    validation = _node("validation", "Rapor Doğrulama", ACTIVE, "ReportValidator + atıf kontrolü")
    review = _node(
        "review",
        "Veteriner Radyolog İncelemesi",
        ACTIVE,
        f"{usage['awaiting_review']} vaka inceleme bekliyor",
    )
    approved = _node("approved", "Onaylı Rapor", ACTIVE, f"{usage['approved']} onaylı rapor")

    rows: list[list[dict[str, Any]]] = [
        [upload],
        [quarantine],
        [dicom_parser, doc_parser],
        [classifier],
        [confirm],
        [router],
        branches,
        [findings],
        [gateway, rag],
        [llm],
        [validation],
        [review],
        [approved],
    ]
    all_nodes = [n for row in rows for n in row]
    return {
        "generated_at": _iso(datetime.now(timezone.utc)),
        "rows": [[n["id"] for n in row] for row in rows],
        # Nodes drawn beside the main flow with a dashed arrow, not as a branch.
        "side_nodes": ["rag"],
        "nodes": {n["id"]: n for n in all_nodes},
        "summary": {
            "real": sum(1 for n in all_nodes if n["status"] == ACTIVE and n["id"] in _AI_NODES),
            "mock": sum(1 for n in all_nodes if n["status"] == MOCK),
            "fallback": sum(1 for n in all_nodes if n["status"] == FALLBACK),
            "off": sum(1 for n in all_nodes if n["status"] == OFF),
            "recent_jobs": usage["jobs_seen"],
        },
    }


_AI_NODES = {"xray", "ct", "mri", "document", "rag", "llm"}


def _branch_title(modality: Modality, chosen: list[ModelCapability]) -> str:
    if any(c.adapter_kind == "vlm" for c in chosen):
        return "Multimodal VLM"
    return {
        Modality.XR: "X-Ray Vision Modeli",
        Modality.CT: "CT 3D Modeli",
        Modality.MR: "MRI Modeli",
        Modality.OTHER: "Multimodal VLM",
    }[modality]
