import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { JobEvent } from "./types";

export function useJobEvents(jobId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!jobId) {
      return undefined;
    }

    const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    const refreshStatus = () => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    };
    const refreshTerminalState = () => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["manifest", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["logs", jobId] });
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as JobEvent;
        if (payload.type === "job.finished" || payload.type === "job.cancelled") {
          refreshTerminalState();
        } else if (payload.type === "job.updated" || payload.type === "job.cancelling") {
          refreshStatus();
        }
      } catch {
        refreshStatus();
      }
    };
    source.addEventListener("job.updated", refreshStatus);
    source.addEventListener("job.finished", refreshTerminalState);
    source.addEventListener("job.cancelling", refreshStatus);
    source.addEventListener("job.cancelled", refreshTerminalState);

    return () => {
      source.close();
    };
  }, [jobId, queryClient]);
}
