from __future__ import annotations

import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class JobState(str, Enum):
    prepared = "prepared"
    queued = "queued"
    running = "running"
    cancelling = "cancelling"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    interrupted = "interrupted"
    archived = "archived"


class JobType(str, Enum):
    tracking = "tracking"
    cell_lumen = "cell_lumen"
    lineage_tree = "lineage_tree"


class SlurmJobOptions(BaseModel):
    enabled: bool = False
    jobName: str | None = None
    partition: str | None = None
    account: str | None = None
    qos: str | None = None
    nodelist: str | None = None
    timeLimit: str = "24:00:00"
    cpusPerTask: int = Field(default=32, ge=1, le=100)
    memory: str = "64G"
    nodes: int = Field(default=1, ge=1, le=4)

    @field_validator("jobName", "partition", "account", "qos", "nodelist", mode="before")
    @classmethod
    def normalize_optional_directive_value(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        return stripped or None

    @field_validator(
        "jobName",
        "partition",
        "account",
        "qos",
        "nodelist",
        "timeLimit",
        "memory",
    )
    @classmethod
    def require_single_line_directive_value(cls, value: str | None) -> str | None:
        if value is not None and any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Slurm option values cannot contain control characters")
        return value

    @field_validator("partition", "account", "qos", "nodelist", "timeLimit", "memory")
    @classmethod
    def require_single_directive_token(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[A-Za-z0-9_.:@,+\-\[\]]+", value):
            raise ValueError("Slurm option values must be a single token")
        return value


class CreateJobRequest(BaseModel):
    label: str | None = None
    type: JobType = JobType.tracking
    exportMode: Literal["full", "compact"] = "full"
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
    runner: Literal["local", "slurm"] = "local"
    slurm: SlurmJobOptions = Field(default_factory=SlurmJobOptions)
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
    runner: Literal["local", "slurm"] = "local"
    slurmJobId: str | None = None
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


class SlurmStatus(BaseModel):
    available: bool
    sbatch: str | None = None
    squeue: str | None = None
    scancel: str | None = None
    sacct: str | None = None
    diagnostics: list[str] = Field(default_factory=list)


class SlurmNode(BaseModel):
    name: str
    partitions: list[str] = Field(default_factory=list)
    state: str
    cpusTotal: int | None = None
    cpusAllocated: int | None = None
    cpusIdle: int | None = None
    cpusOther: int | None = None
    memoryMb: int | None = None
    gres: str | None = None
    reason: str | None = None
    selectable: bool = True


class SlurmNodesResponse(BaseModel):
    available: bool
    sinfo: str | None = None
    nodes: list[SlurmNode] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)
