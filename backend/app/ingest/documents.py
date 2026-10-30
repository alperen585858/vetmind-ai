"""Extract draft-context text from quarantined documents. No OCR / no diagnosis."""

from __future__ import annotations

import base64
import json
from io import BytesIO
from typing import Protocol
from urllib import error, request as urlrequest

from app.schemas.enums import FileContentKind

_MAX_CHARS = 12_000


class DocumentTextAdapter(Protocol):
    def extract(self, kind: FileContentKind, data: bytes, filename: str) -> tuple[str | None, bool]: ...


class DefaultDocumentTextAdapter:
    """PDF/text native extract; images stay stub unless OCR endpoint is configured."""

    def __init__(self, ocr_endpoint: str | None = None, ocr_timeout_s: float = 30.0) -> None:
        self._ocr_endpoint = (ocr_endpoint or "").strip() or None
        self._ocr_timeout_s = max(1.0, ocr_timeout_s)

    def extract(self, kind: FileContentKind, data: bytes, filename: str) -> tuple[str | None, bool]:
        if kind == FileContentKind.TEXT:
            text = data.decode("utf-8", errors="replace").strip()
            return _truncate(text)

        if kind == FileContentKind.PDF:
            return _extract_pdf(data)

        if kind in {FileContentKind.JPEG, FileContentKind.PNG}:
            if self._ocr_endpoint:
                return _extract_via_ocr_stub(
                    self._ocr_endpoint,
                    kind,
                    data,
                    filename,
                    timeout_s=self._ocr_timeout_s,
                )
            stub = (
                f"[Image file '{filename}' quarantined; kind={kind.value}. "
                "OCR/caption model not attached in this demo — no pixel diagnosis.]"
            )
            return stub, False

        if kind == FileContentKind.DICOM:
            return (
                f"[DICOM file '{filename}' should use /api/v1/dicom/upload, not document ingest.]",
                False,
            )

        return f"[Unsupported/unknown file '{filename}' retained in quarantine only.]", False


_default_adapter = DefaultDocumentTextAdapter()


def build_document_text_adapter(
    *,
    ocr_endpoint: str | None = None,
    ocr_timeout_s: float = 30.0,
) -> DocumentTextAdapter:
    return DefaultDocumentTextAdapter(ocr_endpoint=ocr_endpoint, ocr_timeout_s=ocr_timeout_s)


def extract_document_text(
    kind: FileContentKind,
    data: bytes,
    filename: str,
    *,
    adapter: DocumentTextAdapter | None = None,
) -> tuple[str | None, bool]:
    return (adapter or _default_adapter).extract(kind, data, filename)


def _truncate(text: str) -> tuple[str | None, bool]:
    if not text:
        return None, False
    if len(text) <= _MAX_CHARS:
        return text, False
    return text[:_MAX_CHARS] + "\n…[truncated]", True


def _extract_pdf(data: bytes) -> tuple[str | None, bool]:
    try:
        from pypdf import PdfReader
    except ImportError:
        return (
            "[PDF text extraction unavailable: install pypdf. File remains in quarantine.]",
            False,
        )
    try:
        reader = PdfReader(BytesIO(data))
        parts: list[str] = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        text = "\n".join(parts).strip()
        if not text:
            return "[PDF contained no extractable text layer.]", False
        return _truncate(text)
    except Exception as exc:  # noqa: BLE001
        return f"[PDF parse failed: {type(exc).__name__}. File remains in quarantine.]", False


def _extract_via_ocr_stub(
    endpoint: str,
    kind: FileContentKind,
    data: bytes,
    filename: str,
    *,
    timeout_s: float,
) -> tuple[str | None, bool]:
    """POST wire format in fixtures/integration/document_ocr_request.example.json."""
    payload = {
        "filename": filename,
        "content_kind": kind.value,
        "content_base64": base64.b64encode(data).decode("ascii"),
        "note": "Demo OCR stub — not clinical transcription.",
    }
    body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw)
        text = (parsed.get("text") or parsed.get("passage") or "").strip()
        if not text:
            return (
                f"[OCR endpoint returned no text for '{filename}'. File remains in quarantine.]",
                False,
            )
        prefix = "[OCR stub]"
        return _truncate(f"{prefix} {text}")
    except (error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        return (
            f"[OCR stub failed for '{filename}': {type(exc).__name__}. "
            "File remains in quarantine; no diagnosis.]",
            False,
        )
