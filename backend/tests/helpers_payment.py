"""Shared helpers for demo payment + submission finalize in tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

DEMO_CARD = {
    "card_number": "4242424242424242",
    "expiry": "12/34",
    "cvc": "123",
}


def approve_demo_payment(client: TestClient, submission_id: str, headers: dict[str, str]) -> dict:
    """Create + confirm demo payment (auto-finalizes draft → pending_verification)."""
    intent = client.post(
        "/api/v1/payments/intents",
        json={"submission_id": submission_id},
        headers=headers,
    )
    assert intent.status_code == 201, intent.text
    payment_id = intent.json()["payment_id"]
    confirmed = client.post(
        f"/api/v1/payments/intents/{payment_id}/confirm-demo",
        json=DEMO_CARD,
        headers=headers,
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["payment"]["status"] == "approved"
    assert body["message"] == "Demo Payment Approved"
    return body
