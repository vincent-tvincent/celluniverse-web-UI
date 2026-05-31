import { Activity, PauseCircle, PlayCircle } from "lucide-react";
import type { JobStatus } from "../../types";
import PanelHeading from "./PanelHeading";

type StatusPanelProps = {
  job?: JobStatus;
  loading: boolean;
  onHide: () => void;
};

export default function StatusPanel({ job, loading, onHide }: StatusPanelProps) {
  const progress = Math.round((job?.progress ?? 0) * 100);
  const stateIcon = job?.state === "running" ? <PlayCircle size={17} /> : job?.state === "cancelled" ? <PauseCircle size={17} /> : <Activity size={17} />;
  return (
    <section className="tool-panel">
      <PanelHeading title="Status" icon={stateIcon} onHide={onHide} />
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
              <dt>Current</dt>
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
            <div>
              <dt>TIFF</dt>
              <dd>{job.outputReady.tiffFrames.length}</dd>
            </div>
          </dl>
          {job.error ? <p className="error-text">{job.error}</p> : null}
        </>
      ) : (
        <p className="muted">No job selected</p>
      )}
    </section>
  );
}
