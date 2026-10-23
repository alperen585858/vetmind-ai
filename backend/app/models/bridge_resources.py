"""Resource limits and scoped temp artifacts for Vision bridge prep."""

from __future__ import annotations

import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ResourceLimits:
    """Configurable caps for pixel prep / inference bridge (advisory + hard checks)."""

    max_instances: int = 512
    max_tensor_bytes: int = 256 * 1024 * 1024  # 256 MiB
    inference_timeout_s: float = 30.0
    artifact_ttl_s: float = 3600.0
    transmit_pixels_over_http: bool = False  # default-deny pixel egress


class ArtifactWorkspace:
    """Case-scoped temp dir under a controlled root; always cleaned via close()."""

    def __init__(self, root: Path, *, case_id: str) -> None:
        self._root = root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        safe_case = "".join(c if c.isalnum() or c in "._-" else "_" for c in case_id)[:64]
        self.path = (self._root / f"bridge-{safe_case}-{uuid.uuid4().hex[:10]}").resolve()
        self.path.mkdir(parents=True, exist_ok=False)
        self._closed = False
        self.created_at = time.time()

    def write_bytes(self, name: str, data: bytes) -> Path:
        if self._closed:
            raise RuntimeError("ArtifactWorkspace already closed.")
        target = (self.path / Path(name).name).resolve()
        try:
            target.relative_to(self.path)
        except ValueError as exc:
            raise ValueError("Artifact path escapes workspace.") from exc
        target.write_bytes(data)
        return target

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.path.is_dir():
            shutil.rmtree(self.path, ignore_errors=True)

    def __enter__(self) -> ArtifactWorkspace:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def enforce_instance_limit(count: int, limits: ResourceLimits) -> None:
    from app.models.errors import IncompatibleInputError

    if count > limits.max_instances:
        raise IncompatibleInputError(
            f"Instance count {count} exceeds max_instances={limits.max_instances}."
        )


def enforce_tensor_bytes(nbytes: int, limits: ResourceLimits) -> None:
    from app.models.errors import IncompatibleInputError

    if nbytes > limits.max_tensor_bytes:
        raise IncompatibleInputError(
            f"Prepared tensor size {nbytes} exceeds max_tensor_bytes={limits.max_tensor_bytes}."
        )
