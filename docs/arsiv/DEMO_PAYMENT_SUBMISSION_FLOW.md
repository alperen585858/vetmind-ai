# Demo Payment Before Imaging Submission

**Scope:** Simulated authorization only · **100 EUR** per imaging request · **no real charge**  
**Constraint:** Never store or log card PAN / expiry / CVV. No payment gateway.

---

## State transitions

### Imaging submission

```
create_submission
    → draft
       (DICOM/document attach allowed; clinic vets do not see drafts)

POST /payments/intents  →  DemoPayment requires_confirmation
POST /payments/intents/{id}/confirm-demo
    → approved  →  auto finalize_submission
    → failed    →  remains draft (finalize → 402)

finalize_submission (idempotent)
    → pending_verification   (clinic notified once)
       → needs_info | verified | linked | rejected  (existing vet workflow)
```

Failed demo payment never promotes `draft` → `pending_verification`.  
Re-confirming an already `approved` payment returns the same payment and does not create a second submission.

### Demo payment

| Status | Meaning |
|--------|---------|
| `requires_confirmation` | Intent created; awaiting demo card validation |
| `approved` | Simulator accepted predefined test card; submission may finalize |
| `failed` | Simulator declined (wrong/declined test card); finalize blocked |

Fields persisted: `payment_id`, `submission_id`, `amount` (100), `currency` (`EUR`), `mode` (`demo`), `status`, owner/clinic, timestamps.  
**Not** persisted: card number, expiry, CVC.

### Test card (frontend + backend)

| Result | Number | Expiry | CVC |
|--------|--------|--------|-----|
| Approve | `4242424242424242` | `12/34` | `123` |
| Decline | `4000000000000002` | any | any |

---

## API

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/v1/submissions` | Creates **draft** only |
| `POST` | `/api/v1/submissions/{id}/finalize` | Requires approved demo payment (402 otherwise) |
| `POST` | `/api/v1/payments/intents` | Body: `{ submission_id }` · idempotent per submission |
| `GET` | `/api/v1/payments/intents/{payment_id}` | Tenant/owner scoped |
| `GET` | `/api/v1/payments/by-submission/{submission_id}` | Resume after refresh |
| `POST` | `/api/v1/payments/intents/{id}/confirm-demo` | Validates demo card; auto-finalizes on success |

Audit events (no card data): `payment.intent_created`, `payment.demo_approved`, `payment.demo_failed`.

---

## Frontend wizard (`/basvurular`)

1. Hayvan ve klinik bilgileri  
2. DICOM dosyası seç (or demo DICOM)  
3. Talep özeti · **100 EUR**  
4. Ödeme ekranı · **DEMO / NO REAL CHARGE**  
5. On success → **Demo Payment Approved** → navigate to `/basvurular/{submission_id}`

Draft `submission_id` / `payment_id` are kept in `sessionStorage` so a refresh does not lose an approved demo payment.

---

## Security notes

- Backend status is authoritative; FE cannot finalize without an approved payment.
- Cross-user confirm/get → 404 (owner mismatch) or 403 (non-payer role).
- Unpaid drafts are hidden from vet/clinic_owner lists.
- Card fields are validated in memory and discarded; responses and audit records never echo them.
