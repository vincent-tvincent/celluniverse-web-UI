import { Activity, CircleAlert, CircleCheck, CircleX, Clock3, LoaderCircle, Play, Square } from "lucide-react";
import type { JobStatus } from "../../types";
import PanelHeading from "./PanelHeading";

type StatusPanelProps = {
  job?: JobStatus;
  loading: boolean;
  actionPending?: boolean;
  onStart?: (jobId: string) => void;
  onResume?: (jobId: string) => void;
  onTerminate?: (job: JobStatus) => void;
  onHide: () => void;
};

export default function StatusPanel({ job, loading, actionPending = false, onStart, onResume, onTerminate, onHide }: StatusPanelProps) {
  const progress = Math.round((job?.progress ?? 0) * 100);
  const stateClass = job?.state ?? "idle";
  const stateIcon =
    job?.state === "running" ? (
      <LoaderCircle className="spin-small" size={17} />
    ) : job?.state === "queued" ? (
      <Clock3 size={17} />
    ) : job?.state === "completed" ? (
      <CircleCheck size={17} />
    ) : job?.state === "failed" ? (
      <CircleAlert size={17} />
    ) : job?.state === "cancelled" ? (
      <CircleX size={17} />
    ) : (
      <Activity size={17} />
    );
  return (
    <section className="tool-panel">
      <PanelHeading title="Status" icon={<span className={`status-heading-icon ${stateClass}`}>{stateIcon}</span>} onHide={onHide} />
      {loading && !job ? (
        <p className="muted">Loading job status</p>
      ) : job ? (
        <>
          <div className="status-line">
            <span className={`state-dot ${job.state}`} />
            <strong>{job.state}</strong>
            <span>{job.completedFrames}/{job.totalFrames} frames</span>
          </div>
          <div className="progress-track">
            <div style={{ width: `${progress}%` }} />
          </div>
          <dl className="metric-grid">
            <div>
              <dt>Current Frame</dt>
              <dd>{job.currentFrame ?? "-"}</dd>
            </div>
            <div>
              <dt>Last Done</dt>
              <dd>{job.lastCompletedFrame ?? "-"}</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>{job.firstFrame}-{job.lastFrame}</dd>
            </div>
          </dl>
          <div className="status-actions">
            {job.state === "prepared" && onStart ? (
              <button className="action-button" type="button" disabled={actionPending} onClick={() => onStart(job.id)}>
                <Play size={14} /> Start
              </button>
            ) : null}
            {job.resumeAvailable && onResume ? (
              <button className="action-button" type="button" disabled={actionPending} onClick={() => onResume(job.id)}>
                <Play size={14} /> Resume
              </button>
            ) : null}
            {(job.state === "running" || job.state === "queued") && onTerminate ? (
              <button className="cancel-button" type="button" disabled={actionPending} onClick={() => onTerminate(job)}>
                <Square size={14} /> Terminate
              </button>
            ) : null}
          </div>
          {job.error ? <p className="error-text">{job.error}</p> : null}
        </>
      ) : (
        <p className="muted">No job selected</p>
      )}
    </section>
  );
}
