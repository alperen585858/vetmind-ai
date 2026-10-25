#!/usr/bin/env python3
"""Create 5 detailed GitHub issues from draft markdown files."""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "alperen585858/vetmind-ai"
API = f"https://api.github.com/repos/{REPO}/issues"
DRAFTS = Path(__file__).resolve().parent

ISSUES = [
    {
        "file": "01-hybrid-classification.md",
        "title": "[ISS-CLS-01] Hybrid Classification gerçek hibrit değil — ikinci sinyal ekle",
        "labels": ["enhancement", "ai-pipeline", "P1"],
    },
    {
        "file": "02-rag-grounding.md",
        "title": "[ISS-RAG-04/05] RAG grounding: used-passages + finding↔citation bağlama",
        "labels": ["bug", "rag", "P2"],
    },
    {
        "file": "03-feedback-audit-store.md",
        "title": "[ISS-AUD-01] Feedback / Audit Store — reject/revision → training-signal",
        "labels": ["enhancement", "architecture", "P1"],
    },
    {
        "file": "04-fe-pipeline-fiction.md",
        "title": "[ISS-FE-01] FE pipeline.ts fiction’ını backend gerçeğinden ayır",
        "labels": ["frontend", "documentation", "P2"],
    },
    {
        "file": "05-conflict-ontology.md",
        "title": "[ISS-FUS-01] Conflict detection: ontology + laterality + SOP-anchor",
        "labels": ["enhancement", "ai-pipeline", "P2"],
    },
]


def git_token() -> str:
    proc = subprocess.run(
        ["git", "credential-osxkeychain", "get"],
        input="protocol=https\nhost=github.com\n\n",
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(f"credential helper failed: {proc.stderr}")
    for line in proc.stdout.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1]
    raise SystemExit("No github.com password in osxkeychain")


def ensure_labels(token: str, names: list[str]) -> None:
    """Create missing labels (best-effort)."""
    colors = {
        "enhancement": "a2eeef",
        "bug": "d73a4a",
        "frontend": "61dafb",
        "documentation": "0075ca",
        "ai-pipeline": "7057ff",
        "rag": "0e8a16",
        "architecture": "fbca04",
        "P1": "b60205",
        "P2": "e4e669",
    }
    for name in names:
        body = json.dumps(
            {
                "name": name,
                "color": colors.get(name, "ededed"),
                "description": f"VetMind: {name}",
            }
        ).encode()
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/labels",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
                "User-Agent": "vetmind-issue-bootstrap",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            # 422 = already exists
            if exc.code not in (422,):
                err = exc.read().decode("utf-8", errors="replace")
                print(f"label {name!r}: HTTP {exc.code} {err}", file=sys.stderr)


def create_issue(token: str, title: str, body: str, labels: list[str]) -> dict:
    payload = json.dumps({"title": title, "body": body, "labels": labels}).encode()
    req = urllib.request.Request(
        API,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "vetmind-issue-bootstrap",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"create issue failed HTTP {exc.code}: {err}") from exc


def main() -> None:
    token = git_token()
    # Verify auth
    req = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "vetmind-issue-bootstrap",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        user = json.loads(resp.read().decode())
    print(f"Authenticated as: {user.get('login')}")

    all_labels = sorted({lab for item in ISSUES for lab in item["labels"]})
    ensure_labels(token, all_labels)

    created: list[str] = []
    for item in ISSUES:
        path = DRAFTS / item["file"]
        body = path.read_text(encoding="utf-8")
        footer = (
            "\n\n---\n"
            "_Kaynak gap analizi: `docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md` · "
            "Hedef mimari diyagramı gap kapanışı._\n"
        )
        result = create_issue(token, item["title"], body + footer, item["labels"])
        url = result.get("html_url", "")
        number = result.get("number")
        print(f"#{number} {url}")
        created.append(url)

    print("\nDone. Created:")
    for u in created:
        print(u)


if __name__ == "__main__":
    main()
