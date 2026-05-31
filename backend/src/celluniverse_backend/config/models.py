from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8765
    publicBaseUrl: str = "http://127.0.0.1:8765"
    apiPrefix: str = "/api"
    corsAllowedOrigins: list[str] = Field(default_factory=lambda: [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ])
    eventsTransport: Literal["sse", "websocket"] = "sse"


class CellUniverseConfig(BaseModel):
    celluniverseCppRoot: Path = Path("/home/blue-lobster/p2/UCI/CS295p/CellUniverse/C++")
    buildDir: str = "build"
    threads: int | Literal["auto"] = "auto"

    @property
    def binary(self) -> Path:
        return self.celluniverseCppRoot / self.buildDir / "celluniverse"

    @property
    def config_dir(self) -> Path:
        return self.celluniverseCppRoot / "config"

    @property
    def scripts_dir(self) -> Path:
        return self.celluniverseCppRoot / "scripts"

    @property
    def models_dir(self) -> Path:
        return self.celluniverseCppRoot / "models"

    @property
    def default_config(self) -> Path:
        return self.config_dir / "config.yaml"


class RuntimeConfig(BaseModel):
    runtimeRoot: Path = Path("/home/blue-lobster/p2/UCI/CS295p/celluniverse-web-UI/backend/runtime")
    maxConcurrentJobs: int = 1
    keepJobDays: int = 14


class SecurityConfig(BaseModel):
    allowedInputRoots: list[Path] = Field(default_factory=list)
    allowedInitialCsvRoots: list[Path] = Field(default_factory=list)
    allowedConfigRoots: list[Path] = Field(default_factory=list)


class UploadsConfig(BaseModel):
    maxUploadSizeMb: int = 500
    allowedTiffExtensions: list[str] = Field(default_factory=lambda: [".tif", ".tiff"])


class PreviewConfig(BaseModel):
    defaultFormat: Literal["png-stack", "ome-zarr"] = "png-stack"
    enableOmeZarr: bool = False
    enable3D: bool = False


class LimitsConfig(BaseModel):
    maxConcurrentJobs: int = 1
    maxFrameCount: int = 200
    maxUploadSizeMb: int = 500
    maxRuntimeMinutes: int = 720
    maxThreads: int = 32


class DebugLogsConfig(BaseModel):
    enabled: bool = True
    roots: list[Path] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=lambda: ["**/*.log", "**/*.txt", "**/logs/*"])


class AuthConfig(BaseModel):
    mode: Literal["none", "shared-token"] = "none"
    tokenEnv: str = "CELLUNIVERSE_WEB_TOKEN"


class BackendConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    celluniverse: CellUniverseConfig = Field(default_factory=CellUniverseConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    uploads: UploadsConfig = Field(default_factory=UploadsConfig)
    preview: PreviewConfig = Field(default_factory=PreviewConfig)
    limits: LimitsConfig = Field(default_factory=LimitsConfig)
    debugLogs: DebugLogsConfig = Field(default_factory=DebugLogsConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)

    def normalized(self) -> "BackendConfig":
        if not self.security.allowedInputRoots:
            self.security.allowedInputRoots = [self.runtime.runtimeRoot / "uploads"]
        if not self.security.allowedInitialCsvRoots:
            self.security.allowedInitialCsvRoots = [
                self.celluniverse.config_dir,
                self.runtime.runtimeRoot / "uploads",
            ]
        if not self.security.allowedConfigRoots:
            self.security.allowedConfigRoots = [
                self.celluniverse.config_dir,
                self.runtime.runtimeRoot / "uploads",
            ]
        return self
