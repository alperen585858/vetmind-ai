"""Extract draft-context text from quarantined documents. No OCR / no diagnosis."""

from __future__ import annotations

from io import BytesIO

from app.schemas.enums import FileContentKind

_MAX_CHARS = 12_000


def extract_document_text(kind: FileContentKind, data: bytes, filename: str) -> tuple[str | None, bool]:
    """Return (text, truncated). Image kinds get a caption stub only."""
    if kind == FileContentKind.TEXT:
        text = data.decode("utf-8", errors="replace").strip()
        return _truncate(text)

    if kind == FileContentKind.PDF:
        return _extract_pdf(data)

    if kind in {FileContentKind.JPEG, FileContentKind.PNG}:
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
