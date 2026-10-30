"""Document OCR stub adapter (ISS-ING-05 surface)."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

from app.ingest.documents import DefaultDocumentTextAdapter
from app.schemas.enums import FileContentKind


class _OcrHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        _ = self.rfile.read(length)
        body = json.dumps({"text": "Stub OCR line for draft context."}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def test_image_uses_ocr_endpoint_when_configured() -> None:
    server = HTTPServer(("127.0.0.1", 0), _OcrHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        adapter = DefaultDocumentTextAdapter(
            ocr_endpoint=f"http://127.0.0.1:{port}/ocr",
            ocr_timeout_s=5.0,
        )
        text, truncated = adapter.extract(FileContentKind.PNG, b"\x89PNG", "scan.png")
        assert text is not None
        assert "Stub OCR line" in text
        assert truncated is False
    finally:
        server.shutdown()


def test_image_without_endpoint_returns_stub() -> None:
    adapter = DefaultDocumentTextAdapter()
    text, _ = adapter.extract(FileContentKind.JPEG, b"\xff\xd8", "photo.jpg")
    assert text is not None
    assert "OCR/caption model not attached" in text
