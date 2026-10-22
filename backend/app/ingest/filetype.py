"""Sniff upload bytes → FileContentKind for routing (DICOM vs PDF/JPG/PNG/text)."""

from __future__ import annotations

from pathlib import Path

from app.schemas.enums import FileContentKind


def detect_file_kind(filename: str, data: bytes) -> FileContentKind:
    if len(data) >= 132 and data[128:132] == b"DICM":
        return FileContentKind.DICOM
    if data.startswith(b"%PDF"):
        return FileContentKind.PDF
    if data.startswith(b"\xff\xd8\xff"):
        return FileContentKind.JPEG
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return FileContentKind.PNG

    suffix = Path(filename).suffix.lower()
    if suffix in {".dcm", ".dicom"}:
        return FileContentKind.DICOM
    if suffix == ".pdf":
        return FileContentKind.PDF
    if suffix in {".jpg", ".jpeg"}:
        return FileContentKind.JPEG
    if suffix == ".png":
        return FileContentKind.PNG
    if suffix in {".txt", ".md", ".csv"}:
        return FileContentKind.TEXT

    # UTF-8-ish plain text heuristic for small files without extension.
    if data and len(data) < 512_000:
        try:
            sample = data[:4000].decode("utf-8")
        except UnicodeDecodeError:
            return FileContentKind.UNKNOWN
        if sample.isprintable() or "\n" in sample or "\t" in sample:
            return FileContentKind.TEXT
    return FileContentKind.UNKNOWN
