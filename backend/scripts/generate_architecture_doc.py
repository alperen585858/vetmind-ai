"""Generate docs/AI_MIMARISI.md from the code (same source as the admin "AI Mimarisi" page).

    python scripts/generate_architecture_doc.py          # rewrite the file
    python scripts/generate_architecture_doc.py --check  # exit 1 if the file is out of date

The doc shows the default setup (no backend/.env): every VETMIND_* variable is cleared,
storage is in memory and RAG uses hash embeddings, so the output is the same on every
machine and in CI. Live statuses are on the admin page.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
DOC = REPO / "docs" / "AI_MIMARISI.md"

for key in [k for k in os.environ if k.startswith("VETMIND_")]:
    del os.environ[key]
os.environ["VETMIND_STORAGE"] = "memory"
os.environ["VETMIND_RAG_EMBEDDING"] = "hash"
sys.path.insert(0, str(BACKEND))

from app.container import AppContainer  # noqa: E402
from app.services.architecture_status import build_architecture, to_mermaid  # noqa: E402
from app.services.repository import InMemoryCaseRepository  # noqa: E402
from app.settings import Settings  # noqa: E402

STATUS_TEXT = {
    "active": "🟢 Gerçek / her zaman çalışan adım",
    "mock": "🟡 Mock (sahte çıktı)",
    "fallback": "🟠 Yedeğe düştü",
    "off": "⚪ Kapalı / yapılandırılmamış",
}


def render() -> str:
    tmp = Path(tempfile.mkdtemp(prefix="vetmind-arch-"))
    container = AppContainer(
        repo=InMemoryCaseRepository(),
        settings=Settings(
            storage_backend="memory",
            sqlite_path=tmp / "unused.sqlite3",
            quarantine_root=tmp / "quarantine",
            analyze_gate_path=tmp / "analyze_gate.count",
        ),
    )
    arch = build_architecture(container)
    nodes = arch["nodes"]

    out = [
        "<!-- Bu dosya otomatik üretilir; elle düzenlemeyin.",
        "     Kaynak: backend/app/services/architecture_status.py",
        "     Yeniden üretmek için: cd backend && python scripts/generate_architecture_doc.py -->",
        "",
        "# VetMind AI — Yapay Zekâ Akışı",
        "",
        "Yüklemeden onaylı rapora kadar AI akışı. Diyagram koddan üretilir: analiz adımları "
        "`orchestration/progress.py` içindeki `PIPELINE_STAGES` listesinden, router dalları `Modality` "
        "listesinden, modeller kayıtlı model tablosundan gelir. Kod değişince GitHub Action bu dosyayı "
        "yeniden üretir.",
        "",
        "Renkler **varsayılan kurulumu** gösterir (`.env` yok: mock LLM, mock görüntü modelleri, hash "
        "embedding). Çalışan sistemin canlı durumu admin panelinde **AI Mimarisi** sayfasındadır.",
        "",
        "```mermaid",
        to_mermaid(arch).rstrip("\n"),
        "```",
        "",
        " · ".join(STATUS_TEXT[s] for s in STATUS_TEXT),
        "",
        "## Kod karşılıkları",
        "",
        "| Kutu | Kod |",
        "|------|-----|",
    ]
    seen: set[tuple[str, ...]] = set()
    for n in nodes.values():
        code = tuple(n.get("code", []))
        label = n["label"] if not n.get("branch_label") else f"{n['branch_label']} dalı"
        if code in seen and n.get("branch_label"):
            continue  # all router branches share the adapter files; list them once
        seen.add(code)
        if n.get("branch_label"):
            label = "Router dalları (" + ", ".join(
                m["branch_label"] for m in nodes.values() if m.get("branch_label")
            ) + ")"
        files = ", ".join(f"`{c.removeprefix('backend/app/')}`" for c in code) or "—"
        out.append(f"| {label} | {files} |")
    out += ["", "Akışı yöneten: `orchestration/orchestrator.py` (`AIOrchestrator.run`).", ""]
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if docs/AI_MIMARISI.md is out of date")
    args = parser.parse_args()
    text = render()
    current = DOC.read_text(encoding="utf-8") if DOC.exists() else ""
    if args.check:
        if current != text:
            print(
                "docs/AI_MIMARISI.md is out of date. Run: cd backend && python scripts/generate_architecture_doc.py",
                file=sys.stderr,
            )
            return 1
        print("docs/AI_MIMARISI.md is up to date.")
        return 0
    if current == text:
        print("docs/AI_MIMARISI.md already up to date.")
        return 0
    DOC.write_text(text, encoding="utf-8")
    print(f"Wrote {DOC.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
