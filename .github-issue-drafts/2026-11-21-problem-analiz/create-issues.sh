#!/usr/bin/env bash
# Creates the 10 analysis issues on GitHub.
# Usage (from repo root):
#   ./.tools-gh auth login   # once
#   bash .github-issue-drafts/2026-11-21-problem-analiz/create-issues.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
GH="${ROOT}/.tools-gh"
if [[ ! -x "$GH" ]]; then
  GH="$(command -v gh)"
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

create() {
  local title="$1"
  local file="$2"
  echo "→ $title"
  "$GH" issue create --title "$title" --body-file "$file"
}

create "Uzman ekranında kaynak yoksa sahte/demo yazıyor (yanıltıcı provenance)" \
  "$DIR/01-provenance-mock-default.md"

create "Korumalı modda antivirüs stub her yüklemeyi reddediyor" \
  "$DIR/02-protected-malware-stub.md"

create "Eğitim verisi export başka klinik vakalarını da alabiliyor" \
  "$DIR/03-training-export-tenancy.md"

create "Sahibe giden rapor linki bazen yanlış sürümü açıyor" \
  "$DIR/04-report-link-version-fallback.md"

create "İnceleme listesi eski veri / çalışma alanında sessiz hatalar" \
  "$DIR/05-stale-queue-silent-workspace.md"

create "EN dilinde vaka listesi ve menü hâlâ Türkçe kalıyor" \
  "$DIR/06-caselist-shell-i18n.md"

create "Mesajlar ve vaka listesi AI glow — klinik UI ile birleştir" \
  "$DIR/07-ui-clinical-consistency.md"

create "Expert AI arama Enter’sız; liste sayısı filtreyle uyuşmuyor" \
  "$DIR/08-expert-ai-search-filter.md"

create "Mesajlarda sahte okundu (çift tik) — gerçek read state yok" \
  "$DIR/09-messages-fake-read-receipts.md"

create "Login demo şifreyle dolu; auth kapalıyken API süper yetkili" \
  "$DIR/10-demo-login-auth-off-superuser.md"

echo "Done."
