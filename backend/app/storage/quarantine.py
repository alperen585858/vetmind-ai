"""Local quarantine object store for uploaded study/document bytes.

Files land under ``backend/data/quarantine/{ingest_id}/`` before any model sees them.
Demo-only: not a virus scanner, not production object storage, not encrypted by default.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
_SAFE_INGEST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")


@dataclass(frozen=True)
class QuarantineFileRef:
    """Pointer to a quarantined blob. Models load via this path when authorized."""

    original_filename: str
    stored_filename: str
    relative_path: str
    absolute_path: str
    size_bytes: int
    sha256: str
    content_kind: str = "unknown"


def _safe_filename(name: str, index: int) -> str:
    base = Path(name).name.strip() or f"file-{index}"
    cleaned = _SAFE_NAME.sub("_", base)[:180]
    return f"{index:04d}_{cleaned}"


def validate_ingest_id(ingest_id: str) -> str:
    """Reject path traversal and unsafe ingest identifiers."""
    if not ingest_id or not _SAFE_INGEST.match(ingest_id):
        raise ValueError("Invalid ingest_id.")
    if ".." in ingest_id or "/" in ingest_id or "\\" in ingest_id:
        raise ValueError("Invalid ingest_id.")
    return ingest_id


class QuarantineStore:
    def __init__(self, root: Path, *, max_file_bytes: int | None = None) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_file_bytes = max_file_bytes

    def ingest_dir(self, ingest_id: str) -> Path:
        safe = validate_ingest_id(ingest_id)
        path = (self.root / safe).resolve()
        try:
            path.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Ingest path escapes store root.") from exc
        path.mkdir(parents=True, exist_ok=True)
        return path

    def store_files(
        self,
        ingest_id: str,
        files: list[tuple[str, bytes]],
        *,
        content_kinds: list[str] | None = None,
        owner_subject: str | None = None,
        clinic_id: str | None = None,
    ) -> list[QuarantineFileRef]:
        """Write bytes to quarantine and return stable refs. Empty list is a no-op."""
        if not files:
            return []
        directory = self.ingest_dir(ingest_id)
        refs: list[QuarantineFileRef] = []
        for index, (filename, data) in enumerate(files):
            if self.max_file_bytes is not None and len(data) > self.max_file_bytes:
                raise ValueError(f"File exceeds quarantine max_file_bytes ({self.max_file_bytes}).")
            stored = _safe_filename(filename, index)
            target = directory / stored
            target.write_bytes(data)
            kind = "unknown"
            if content_kinds is not None and index < len(content_kinds):
                kind = content_kinds[index]
            digest = hashlib.sha256(data).hexdigest()
            rel = f"{ingest_id}/{stored}"
            refs.append(
                QuarantineFileRef(
                    original_filename=filename,
                    stored_filename=stored,
                    relative_path=rel,
                    absolute_path=str(target),
                    size_bytes=len(data),
                    sha256=digest,
                    content_kind=kind,
                )
            )
        manifest = {
            "ingest_id": ingest_id,
            "root": str(self.root),
            "owner_subject": owner_subject,
            "clinic_id": clinic_id,
            "files": [asdict(r) for r in refs],
            "note": "Quarantine store — bytes retained for future authorized adapters. Not clinical PACS.",
            "encryption": "none",
        }
        (directory / "manifest.json").write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )
        return refs

    def resolve(self, relative_path: str) -> Path:
        """Resolve a relative quarantine path; reject traversal outside the store root."""
        if not relative_path or relative_path.startswith("/") or ".." in Path(relative_path).parts:
            raise ValueError("Quarantine path escapes store root.")
        path = (self.root / relative_path).resolve()
        try:
            path.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Quarantine path escapes store root.") from exc
        return path

    def cleanup_temp_dir(self, temp_dir: Path) -> None:
        """Remove a temporary prep directory if it stays under the quarantine root."""
        resolved = temp_dir.resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Refusing to delete path outside quarantine root.") from exc
        if resolved.is_dir():
            for child in sorted(resolved.rglob("*"), reverse=True):
                if child.is_file():
                    child.unlink(missing_ok=True)
                elif child.is_dir():
                    child.rmdir()
            resolved.rmdir()

    def remove_ingest(self, ingest_id: str) -> None:
        """Delete an ingest's quarantined bytes + manifest (demo seed cleanup)."""
        path = (self.root / validate_ingest_id(ingest_id)).resolve()
        if path != self.root and path.is_dir():
            self.cleanup_temp_dir(path)

    def ownership(self, ingest_id: str) -> tuple[str | None, str | None]:
        """Return (owner_subject, clinic_id) from manifest when present."""
        try:
            directory = self.ingest_dir(ingest_id)
        except ValueError:
            return None, None
        manifest_path = directory / "manifest.json"
        if not manifest_path.is_file():
            return None, None
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        owner = raw.get("owner_subject")
        clinic = raw.get("clinic_id")
        return (str(owner) if owner else None, str(clinic) if clinic else None)

    def list_files(self, ingest_id: str) -> list[QuarantineFileRef]:
        """Return quarantined file refs for an ingest (from manifest when present)."""
        validate_ingest_id(ingest_id)
        directory = self.root / ingest_id
        manifest_path = directory / "manifest.json"
        if manifest_path.is_file():
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
            refs: list[QuarantineFileRef] = []
            for item in raw.get("files") or []:
                refs.append(
                    QuarantineFileRef(
                        original_filename=str(item.get("original_filename") or "unnamed.dcm"),
                        stored_filename=str(item.get("stored_filename") or ""),
                        relative_path=str(item.get("relative_path") or ""),
                        absolute_path=str(item.get("absolute_path") or ""),
                        size_bytes=int(item.get("size_bytes") or 0),
                        sha256=str(item.get("sha256") or ""),
                        content_kind=str(item.get("content_kind") or "unknown"),
                    )
                )
            return refs
        if not directory.is_dir():
            return []
        # Fallback: directory scan without manifest
        refs = []
        for index, path in enumerate(sorted(directory.iterdir())):
            if not path.is_file() or path.name == "manifest.json":
                continue
            data = path.read_bytes()
            refs.append(
                QuarantineFileRef(
                    original_filename=path.name,
                    stored_filename=path.name,
                    relative_path=f"{ingest_id}/{path.name}",
                    absolute_path=str(path.resolve()),
                    size_bytes=len(data),
                    sha256=hashlib.sha256(data).hexdigest(),
                    content_kind="dicom",
                )
            )
        return refs

    def read_file(self, relative_path: str, *, expected_sha256: str | None = None) -> tuple[str, bytes]:
        """Read quarantined bytes; optionally verify integrity against expected sha256."""
        path = self.resolve(relative_path)
        if not path.is_file():
            raise FileNotFoundError(relative_path)
        data = path.read_bytes()
        if expected_sha256:
            digest = hashlib.sha256(data).hexdigest()
            if digest != expected_sha256:
                raise ValueError("Quarantine integrity check failed.")
        return path.name, data
