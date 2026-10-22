"""Local quarantine object store for uploaded study/document bytes.

Files land under ``backend/data/quarantine/{ingest_id}/`` before any model sees them.
Demo-only: not a virus scanner, not production object storage.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


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


class QuarantineStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def ingest_dir(self, ingest_id: str) -> Path:
        path = self.root / ingest_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def store_files(
        self,
        ingest_id: str,
        files: list[tuple[str, bytes]],
        *,
        content_kinds: list[str] | None = None,
    ) -> list[QuarantineFileRef]:
        """Write bytes to quarantine and return stable refs. Empty list is a no-op."""
        if not files:
            return []
        directory = self.ingest_dir(ingest_id)
        refs: list[QuarantineFileRef] = []
        for index, (filename, data) in enumerate(files):
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
            "files": [asdict(r) for r in refs],
            "note": "Quarantine store — bytes retained for future authorized adapters. Not clinical PACS.",
        }
        (directory / "manifest.json").write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )
        return refs

    def resolve(self, relative_path: str) -> Path:
        path = (self.root / relative_path).resolve()
        if not str(path).startswith(str(self.root)):
            raise ValueError("Quarantine path escapes store root.")
        return path

    def list_files(self, ingest_id: str) -> list[QuarantineFileRef]:
        """Return quarantined file refs for an ingest (from manifest when present)."""
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

    def read_file(self, relative_path: str) -> tuple[str, bytes]:
        """Read quarantined bytes; returns (filename, data)."""
        path = self.resolve(relative_path)
        if not path.is_file():
            raise FileNotFoundError(relative_path)
        return path.name, path.read_bytes()
