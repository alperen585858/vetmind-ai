#!/usr/bin/env python3
"""Encrypt quarantine files written before encryption at rest was turned on (#126).

Run (from backend/, with the server stopped and the same VETMIND_* env as the server):
  set VETMIND_ENCRYPTION_AT_REST=aes-gcm and VETMIND_BLOB_KEY=<key> first, then
  python scripts/encrypt_quarantine.py --dry-run   # count what would change
  python scripts/encrypt_quarantine.py             # encrypt plaintext files in place

Already encrypted files and manifest.json are skipped, so running it twice is safe. Each file
is written to a temporary name and renamed, so an interrupted run leaves no half file.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.settings import load_settings  # noqa: E402
from app.storage.encryption import AesGcmEncryptor, blob_encryptor_from_env, is_encrypted  # noqa: E402


def encrypt_tree(root: Path, *, dry_run: bool = False) -> tuple[int, int]:
    """Return (encrypted, skipped)."""
    enc = blob_encryptor_from_env()
    if not isinstance(enc, AesGcmEncryptor):
        raise SystemExit("Set VETMIND_ENCRYPTION_AT_REST=aes-gcm and VETMIND_BLOB_KEY first.")
    done = skipped = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "manifest.json" or path.name.endswith(".tmp-enc"):
            continue
        data = path.read_bytes()
        if is_encrypted(data):
            skipped += 1
            continue
        done += 1
        if dry_run:
            continue
        tmp = path.with_name(path.name + ".tmp-enc")
        tmp.write_bytes(enc.encrypt(data))
        os.replace(tmp, path)
    return done, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--root", type=Path, default=None, help="quarantine root (default: from settings)")
    args = parser.parse_args()
    root = (args.root or load_settings().quarantine_root).resolve()
    done, skipped = encrypt_tree(root, dry_run=args.dry_run)
    verb = "would encrypt" if args.dry_run else "encrypted"
    print(f"{root}: {verb} {done} file(s), {skipped} already encrypted.")


if __name__ == "__main__":
    main()
