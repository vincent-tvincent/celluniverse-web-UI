import { TerminalSquare } from "lucide-react";
import PanelHeading from "./PanelHeading";

type LogPanelProps = {
  stream: "stdout" | "stderr";
  setStream: (stream: "stdout" | "stderr") => void;
  lines: string[];
  loading: boolean;
  onHide: () => void;
};

export default function LogPanel({ stream, setStream, lines, loading, onHide }: LogPanelProps) {
  return (
    <section className="tool-panel log-panel">
      <PanelHeading title="Runtime Log" icon={<TerminalSquare size={17} />} onHide={onHide} />
      <div className="segmented wide">
        <button type="button" className={stream === "stdout" ? "active" : ""} onClick={() => setStream("stdout")}>
          stdout
        </button>
        <button type="button" className={stream === "stderr" ? "active" : ""} onClick={() => setStream("stderr")}>
          stderr
        </button>
      </div>
      <pre className="log-box" aria-live="polite">
        {lines.length ? lines.join("\n") : loading ? "Loading log..." : "No log lines"}
      </pre>
    </section>
  );
}
