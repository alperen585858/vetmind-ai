"""Export the pretrained TorchXRayVision chest X-ray model as a VetMind XR checkpoint.

    .venv/bin/python scripts/export_xray_model.py [../artifacts/vet-xr-thorax-v1/model.pt]

Prints the file's SHA-256 for VETMIND_LOCAL_TORCH_WEIGHTS_SHA256. Human weights:
demo / initialization only, not veterinary-validated.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.entrypoints.xray_monai import save_txrv_checkpoint  # noqa: E402
from app.models.weight_cache import cached_file_sha256  # noqa: E402


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "../artifacts/vet-xr-thorax-v1/model.pt").resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    save_txrv_checkpoint(str(out))
    print(f"checkpoint: {out}")
    print(f"sha256:     {cached_file_sha256(out)}")


if __name__ == "__main__":
    main()
