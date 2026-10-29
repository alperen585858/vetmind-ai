"""Role-based access helpers for VetMind demo roles."""

from __future__ import annotations

# Capability strings used by require_capability(...)
CAP_CASE_WRITE = "cases:write"
CAP_CASE_READ = "cases:read"
CAP_ANALYZE = "analyze"
CAP_REVIEW = "review"
CAP_DICOM = "dicom"
CAP_DOCUMENTS = "documents"
CAP_RAG_SEARCH = "rag:search"
CAP_RAG_ADMIN = "rag:admin"
CAP_ADMIN = "admin"
CAP_PETS = "pets:write"
CAP_SUBMISSIONS = "submissions:write"
CAP_CLINIC_MANAGE = "clinic:manage"
CAP_USERS_ADMIN = "users:admin"
CAP_MESSAGES = "messages:write"

ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    "demo": frozenset({"*"}),
    "service": frozenset({"*"}),
    "admin": frozenset({"*"}),
    "vet": frozenset(
        {
            CAP_CASE_WRITE,
            CAP_CASE_READ,
            CAP_ANALYZE,
            CAP_DICOM,
            CAP_DOCUMENTS,
            CAP_RAG_SEARCH,
            CAP_SUBMISSIONS,
            CAP_CLINIC_MANAGE,
        }
    ),
    "expert": frozenset(
        {
            CAP_CASE_READ,
            CAP_ANALYZE,
            CAP_REVIEW,
            CAP_RAG_SEARCH,
            CAP_DICOM,  # read/confirm path during review demos
            CAP_MESSAGES,
        }
    ),
    "owner": frozenset(
        {
            CAP_CASE_READ,  # approved/own pets only — enforced in CaseService/tenancy
            CAP_RAG_SEARCH,
            CAP_PETS,
            CAP_SUBMISSIONS,
            CAP_DICOM,  # owner upload into submission quarantine only (API-gated)
            CAP_DOCUMENTS,
            CAP_MESSAGES,
        }
    ),
    "clinic_owner": frozenset(
        {
            CAP_CASE_READ,
            CAP_RAG_SEARCH,
            CAP_CLINIC_MANAGE,
            CAP_SUBMISSIONS,
            CAP_DICOM,  # read linked case studies in clinic worklist
        }
    ),
}


def role_has_capability(role: str, capability: str) -> bool:
    caps = ROLE_CAPABILITIES.get(role, frozenset())
    if "*" in caps:
        return True
    return capability in caps
