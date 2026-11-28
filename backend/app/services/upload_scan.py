"""Run every uploaded file through the configured malware scanner before it is stored."""

from __future__ import annotations

from fastapi import HTTPException, status

from app.http_errors import api_error
from app.storage.malware_scan import MalwareScanner


def scan_uploads_or_raise(scanner: MalwareScanner | None, files: list[tuple[str, bytes]]) -> None:
    """422 when a file is infected, 503 when the scanner cannot give a verdict (fail closed)."""
    if scanner is None:
        return
    for name, data in files:
        result = scanner.scan(data, filename=name)
        if result.clean:
            continue
        if result.infected:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=api_error("malware_detected", f"'{name}' was rejected by the malware scanner."),
            )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=result.detail)
