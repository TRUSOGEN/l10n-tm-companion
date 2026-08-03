"""Dump FastAPI OpenAPI schema to backend/openapi.json."""

from __future__ import annotations

import json
from pathlib import Path

from l10n_backend.api.app import create_app


def main() -> None:
    app = create_app()
    schema = app.openapi()
    out = Path(__file__).resolve().parent.parent / "openapi.json"
    out.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote OpenAPI schema to {out}")


if __name__ == "__main__":
    main()
