from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class JobState(str, Enum):
    prepared = "prepared"
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    interrupted = "interrupted"
    archived = "archived"


class JobType(str, Enum):
    tracking = "tracking"
    cell_lumen = "cell_lumen"
    lineage_tree = "lineage_tree"


class CreateJobRequest(BaseModel):
    label: str | None = None
    type: JobType = JobType.tracking
    inputPath: str | None = None
    datasetId: str | None = None
    firstFrame: int
    lastFrame: int
    initialCsvPath: str | None = None
    initialCsvUploadId: str | None = None
    configYamlPath: str | None = None
    configYamlUploadId: str | None = None
    resumeSourceJobId: str | None = None
    resumeFromFrame: int | None = None
    parameterModuleId: str = "debug-basic"
    overrides: dict[str, Any] = Field(default_factory=dict)
    autoStart: bool = False


class LocalDatasetValidationRequest(BaseModel):
    inputPath: str
    firstFrame: int
    lastFrame: int


class JobStatus(BaseModel):
    id: str
    label: str
    type: JobType
    state: JobState
    createdAt: str
    startedAt: str | None = None
    finishedAt: str | None = None
    firstFrame: int
    lastFrame: int
    currentFrame: int | None = None
    lastCompletedFrame: int | None = None
    completedFrames: int = 0
    totalFrames: int
    progress: float = 0.0
    pid: int | None = None
    exitCode: int | None = None
    error: str | None = None
    queuePosition: int | None = None
    partialOutputsAvailable: bool = False
    outputReady: dict[str, Any] = Field(default_factory=dict)
    resumeAvailable: bool = False
    resumeFromFrame: int | None = None
    resumeSourceDir: str | None = None
    resumeSourceJobId: str | None = None


class ClientConfig(BaseModel):
    apiBaseUrl: str
    eventsTransport: Literal["sse", "websocket"]
    eventsUrl: str
    previewUrlPrefix: str
    downloadUrlPrefix: str
    features: dict[str, bool]


class UploadResponse(BaseModel):
    uploadId: str
    kind: str
    files: list[str]


class EngineStatus(BaseModel):
    ok: bool
    root: str
    binary: str
    configDir: str
    scriptsDir: str
    modelsDir: str
    diagnostics: list[str]
