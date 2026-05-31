import { Layers3, RefreshCcw } from "lucide-react";
import type { JobStatus } from "../../types";

type TopBarProps = {
  jobs: JobStatus[];
  selectedJobId: string;
  onSelect: (jobId: string) => void;
  onRefresh: () => void;
};

export default function TopBar({
  jobs,
  selectedJobId,
  onSelect,
  onRefresh,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-block">
        <div className="brand-mark">
          <Layers3 size={20} />
        </div>
        <div>
          <h1>CellUniverse Live Viewer</h1>
          <p>3D TIFF preview with synthetic overlay and cell geometry</p>
        </div>
      </div>
      <div className="job-select-row">
        <label htmlFor="job-select">Job</label>
        <select id="job-select" value={selectedJobId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Select job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.id} {job.state ? `(${job.state})` : ""}
            </option>
          ))}
        </select>
        <input
          value={selectedJobId}
          onChange={(event) => onSelect(event.target.value.trim())}
          placeholder="job_..."
          aria-label="Job id"
        />
        <button className="icon-button" type="button" onClick={onRefresh} title="Refresh">
          <RefreshCcw size={17} />
        </button>
      </div>
    </header>
  );
}
