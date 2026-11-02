"""Working + immutable evidence artifact storage (overlays / masks).

Working AI evidence lives under ``_evidence/{case_id}/ai/``.
Approved report packages live under ``_report_evidence/{case_id}/v{N}/`` and
must not be TTL-deleted while the approved report is retained.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

_SAFE = re.compile(r"[^a-zA-Z0-9._-]+")


def _safe(part: str, *, max_len: int = 64) -> str:
    cleaned = _SAFE.sub("_", (part or "").strip())[:max_len]
    return cleaned or "x"


@dataclass(frozen=True)
class StoredArtifact:
    evidence_id: str
    relative_path: str
    absolute_path: Path
    content_sha256: str
    kind: str  # overlay_png | mask_npy | meta_json


class EvidenceArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def working_dir(self, case_id: str) -> Path:
        path = (self.root / "_evidence" / _safe(case_id) / "ai").resolve()
        path.mkdir(parents=True, exist_ok=True)
        try:
            path.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Evidence path escapes store root.") from exc
        return path

    def report_package_dir(self, case_id: str, version: int) -> Path:
        path = (
            self.root / "_report_evidence" / _safe(case_id) / f"v{int(version)}"
        ).resolve()
        path.mkdir(parents=True, exist_ok=True)
        try:
            path.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Report evidence path escapes store root.") from exc
        return path

    def write_bytes(
        self,
        case_id: str,
        evidence_id: str,
        *,
        filename: str,
        data: bytes,
        working: bool = True,
        report_version: int | None = None,
    ) -> StoredArtifact:
        if working:
            base = self.working_dir(case_id)
        else:
            if report_version is None:
                raise ValueError("report_version required for immutable package write")
            base = self.report_package_dir(case_id, report_version)
        eid = _safe(evidence_id)
        name = _safe(filename, max_len=120)
        target = (base / f"{eid}_{name}").resolve()
        try:
            target.relative_to(base)
        except ValueError as exc:
            raise ValueError("Artifact filename escapes case dir.") from exc
        target.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        kind = "overlay_png" if name.endswith(".png") else "mask_npy" if name.endswith(".npy") else "blob"
        rel = str(target.relative_to(self.root))
        return StoredArtifact(
            evidence_id=evidence_id,
            relative_path=rel,
            absolute_path=target,
            content_sha256=digest,
            kind=kind,
        )

    def write_json_meta(
        self,
        case_id: str,
        evidence_id: str,
        meta: dict,
        *,
        working: bool = True,
        report_version: int | None = None,
    ) -> StoredArtifact:
        payload = json.dumps(meta, ensure_ascii=False, indent=2).encode("utf-8")
        art = self.write_bytes(
            case_id,
            evidence_id,
            filename="meta.json",
            data=payload,
            working=working,
            report_version=report_version,
        )
        return StoredArtifact(
            evidence_id=art.evidence_id,
            relative_path=art.relative_path,
            absolute_path=art.absolute_path,
            content_sha256=art.content_sha256,
            kind="meta_json",
        )

    def resolve(self, relative_path: str) -> Path:
        path = (self.root / relative_path).resolve()
        try:
            path.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Path escapes evidence store root.") from exc
        if not path.is_file():
            raise FileNotFoundError(relative_path)
        return path

    def copy_into_report_package(
        self,
        *,
        case_id: str,
        version: int,
        evidence_id: str,
        source_relative: str,
        dest_filename: str = "overlay.png",
    ) -> StoredArtifact:
        src = self.resolve(source_relative)
        data = src.read_bytes()
        return self.write_bytes(
            case_id,
            evidence_id,
            filename=dest_filename,
            data=data,
            working=False,
            report_version=version,
        )

    def delete_case_artifacts(self, case_id: str) -> None:
        """Working overlays and frozen report packages of a permanently deleted case."""
        self.delete_working_case(case_id)
        path = (self.root / "_report_evidence" / _safe(case_id)).resolve()
        try:
            path.relative_to(self.root)
        except ValueError:
            return
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)

    def delete_working_case(self, case_id: str) -> None:
        path = (self.root / "_evidence" / _safe(case_id)).resolve()
        try:
            path.relative_to(self.root)
        except ValueError:
            return
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
