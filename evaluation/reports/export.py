"""Deterministic, atomic, local-only evaluation artifact writers."""
from __future__ import annotations
import csv
import json
import os
import tempfile
from pathlib import Path
from collections.abc import Mapping, Sequence
from typing import Any


def _atomic_write(path: Path, content: str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='',
                                         dir=path.parent, prefix='.tmp-', suffix='.part',
                                         delete=False) as stream:
            temp_name = stream.name
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)
    return path


def export_json(path: Path, data: Mapping[str, Any]) -> Path:
    return _atomic_write(path, json.dumps(dict(data), indent=2, ensure_ascii=False,
                                          allow_nan=False, sort_keys=True) + '\n')


def export_csv(path: Path, rows: Sequence[Mapping[str, Any]], columns: Sequence[str]) -> Path:
    import io
    if not columns or len(set(columns)) != len(columns):
        raise ValueError('unique CSV columns required')
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction='raise')
    writer.writeheader()
    for row in rows:
        writer.writerow(dict(row))
    return _atomic_write(path, output.getvalue())


def export_markdown(path: Path, *, title: str, sections: Mapping[str, str]) -> Path:
    if not title.strip():
        raise ValueError('nonempty title required')
    lines = [f'# {title}', '']
    for heading, body in sections.items():
        lines.extend([f'## {heading}', '', body.strip(), ''])
    return _atomic_write(path, '\n'.join(lines))
