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
        }
    ),
    "expert": frozenset(
        {
            CAP_CASE_READ,
            CAP_ANALYZE,
            CAP_REVIEW,
            CAP_RAG_SEARCH,
            CAP_DICOM,  # read/confirm path during review demos
        }
    ),
    "owner": frozenset({CAP_CASE_READ, CAP_RAG_SEARCH}),
}


def role_has_capability(role: str, capability: str) -> bool:
    caps = ROLE_CAPABILITIES.get(role, frozenset())
    if "*" in caps:
        return True
    return capability in caps
