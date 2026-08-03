"""Backend package entrypoints for API and worker processes."""

from __future__ import annotations

import argparse
import sys


def serve_api() -> None:
    import uvicorn
    from .api.app import create_app
    from .config import get_settings

    settings = get_settings()
    app = create_app()
    uvicorn.run(app, host=settings.api_host, port=settings.api_port)


def run_worker() -> None:
    from .models.db import init_engine
    from .config import get_settings
    from .adapters.factory import build_runtime_adapters
    from .workers.roi_worker import RoiWorker

    settings = get_settings()
    init_engine(settings)
    adapters = build_runtime_adapters(settings)
    worker = RoiWorker(
        settings=settings,
        starling=adapters.starling_gateway,
        crypto=adapters.crypto,
    )
    worker.run_forever()


def run_recovery() -> None:
    from .config import get_settings
    from .adapters import FeishuAppCredentials
    from .adapters.factory import build_runtime_adapters
    from .domain.oauth import OAuthService
    from .models.db import init_engine, session_scope

    settings = get_settings()
    init_engine(settings)
    adapters = build_runtime_adapters(settings)
    with session_scope() as db:
        svc = OAuthService(
            db=db,
            settings=settings,
            feishu=adapters.feishu_gateway,
            app_creds=FeishuAppCredentials(
                app_id=settings.feishu_app_id,
                app_secret=adapters.secret_provider.get_secret("feishu_app_secret"),
            ),
            crypto=adapters.crypto,
        )
        svc.recover_uncertain_sessions()


def main() -> None:
    parser = argparse.ArgumentParser(prog="l10n-backend")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("api", help="Run the HTTP API server")
    sub.add_parser("worker", help="Run the async ROI worker")
    sub.add_parser("recover", help="Run OAuth uncertainty recovery once")
    args = parser.parse_args()
    if args.cmd == "api":
        serve_api()
    elif args.cmd == "worker":
        run_worker()
    elif args.cmd == "recover":
        run_recovery()
    else:
        parser.print_help()
        sys.exit(2)


if __name__ == "__main__":
    main()
