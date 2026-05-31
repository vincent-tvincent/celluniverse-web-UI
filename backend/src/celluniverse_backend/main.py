from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from celluniverse_backend.api.routes import install_routes
from celluniverse_backend.config.exposed import ExposedParameterRegistry
from celluniverse_backend.config.loader import REPO_BACKEND_ROOT, load_backend_config
from celluniverse_backend.jobs.manager import JobManager


def create_app() -> FastAPI:
    config = load_backend_config()
    config.runtime.runtimeRoot.mkdir(parents=True, exist_ok=True)
    (config.runtime.runtimeRoot / "uploads").mkdir(parents=True, exist_ok=True)
    (config.runtime.runtimeRoot / "jobs").mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="CellUniverse Backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.server.corsAllowedOrigins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    exposed = ExposedParameterRegistry(REPO_BACKEND_ROOT / "config" / "exposed-parameters")
    jobs = JobManager(config, exposed)

    @app.on_event("startup")
    def startup() -> None:
        jobs.start()

    @app.on_event("shutdown")
    def shutdown() -> None:
        jobs.stop()

    install_routes(app, config, jobs, exposed)
    app.state.backend_config = config
    app.state.job_manager = jobs
    return app


app = create_app()
