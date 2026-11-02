"""GPU-oriented RQ worker for Vision inference jobs.

Run on hosts with CUDA + ``requirements-vision.txt`` installed:

    export VETMIND_REDIS_URL=redis://127.0.0.1:6379/0
    export VETMIND_RQ_QUEUE=vetmind-gpu
    export VETMIND_LOCAL_TORCH_DEVICE=cuda
    python -m app.workers.rq_gpu_worker

Falls back to CPU if CUDA is unavailable (logged). Does not import torch at
module import of the FastAPI app — only when this worker process starts.
"""

from __future__ import annotations

import os
import sys


def _log_device() -> str:
    device = os.getenv("VETMIND_LOCAL_TORCH_DEVICE", "cuda").strip() or "cuda"
    try:
        import torch  # type: ignore[import-not-found]

        if device.startswith("cuda") and not torch.cuda.is_available():
            print("CUDA requested but unavailable; falling back to cpu", file=sys.stderr)
            os.environ["VETMIND_LOCAL_TORCH_DEVICE"] = "cpu"
            return "cpu"
        if device.startswith("cuda"):
            print(f"GPU worker using {device} ({torch.cuda.get_device_name(0)})", file=sys.stderr)
        return device
    except Exception as exc:  # noqa: BLE001
        print(f"torch not available ({type(exc).__name__}); device=cpu", file=sys.stderr)
        os.environ["VETMIND_LOCAL_TORCH_DEVICE"] = "cpu"
        return "cpu"


def main() -> int:
    try:
        from redis import Redis
        from rq import Connection, Worker
    except ImportError:
        print("Install optional deps: pip install redis rq", file=sys.stderr)
        return 1
    _log_device()
    redis_url = os.getenv("VETMIND_REDIS_URL", "redis://127.0.0.1:6379/0")
    queue = os.getenv("VETMIND_RQ_QUEUE", "vetmind-gpu")
    conn = Redis.from_url(redis_url)
    print(f"Starting GPU RQ worker on queue={queue!r}", file=sys.stderr)
    with Connection(conn):
        Worker([queue]).work(with_scheduler=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
