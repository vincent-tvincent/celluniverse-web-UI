import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, Layers3, RefreshCcw } from "lucide-react";
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
        <label htmlFor="job-combobox-input">Job</label>
        <JobCombobox jobs={jobs} selectedJobId={selectedJobId} onSelect={onSelect} />
        <button className="icon-button" type="button" onClick={onRefresh} title="Refresh">
          <RefreshCcw size={17} />
        </button>
      </div>
    </header>
  );
}

function JobCombobox({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: JobStatus[];
  selectedJobId: string;
  onSelect: (jobId: string) => void;
}) {
  const [draft, setDraft] = useState(selectedJobId);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filteredJobs = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const matches = query
      ? jobs.filter((job) => {
          const label = job.label ?? "";
          return (
            job.id.toLowerCase().includes(query) ||
            label.toLowerCase().includes(query) ||
            job.state.toLowerCase().includes(query)
          );
        })
      : jobs;
    return matches.slice(0, 8);
  }, [draft, jobs]);

  useEffect(() => {
    setDraft(selectedJobId);
  }, [selectedJobId]);

  const commitDraft = () => {
    const nextJobId = draft.trim();
    if (nextJobId !== selectedJobId) {
      onSelect(nextJobId);
    }
  };

  const selectJob = (jobId: string) => {
    setDraft(jobId);
    onSelect(jobId);
    setOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((index) => Math.min(filteredJobs.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlightedJob = highlightedIndex >= 0 ? filteredJobs[highlightedIndex] : null;
      if (open && highlightedJob) {
        selectJob(highlightedJob.id);
      } else {
        commitDraft();
        setOpen(false);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className="job-combobox"
      onBlur={(event) => {
        if (rootRef.current?.contains(event.relatedTarget as Node | null)) {
          return;
        }
        commitDraft();
        setOpen(false);
        setHighlightedIndex(-1);
      }}
    >
      <div className="job-combobox-input-wrap">
        <input
          ref={inputRef}
          id="job-combobox-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="job_..."
          aria-label="Job id"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="job-combobox-menu"
          role="combobox"
        />
        <button
          type="button"
          className="job-combobox-toggle"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((value) => !value);
            inputRef.current?.focus();
          }}
          aria-label="Show jobs"
          aria-expanded={open}
        >
          <ChevronDown size={17} />
        </button>
      </div>
      {open ? (
        <div id="job-combobox-menu" className="job-combobox-menu" role="listbox">
          {filteredJobs.length ? (
            filteredJobs.map((job, index) => (
              <button
                key={job.id}
                type="button"
                className={`job-combobox-option ${index === highlightedIndex ? "highlighted" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectJob(job.id)}
                role="option"
                aria-selected={job.id === selectedJobId}
              >
                <span>{job.id}</span>
                {job.state ? <small>{job.state}</small> : null}
              </button>
            ))
          ) : (
            <div className="job-combobox-empty">Press Enter to use this job id</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
