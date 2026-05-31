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
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["manifest", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["logs", jobId] });
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as JobEvent;
        if (
          payload.type === "job.updated" ||
          payload.type === "job.finished" ||
          payload.type === "job.cancelled" ||
          payload.type === "log.line"
        ) {
          invalidate();
        }
      } catch {
        invalidate();
      }
    };
    source.addEventListener("job.updated", invalidate);
    source.addEventListener("job.finished", invalidate);
    source.addEventListener("job.cancelled", invalidate);

    return () => {
      source.close();
    };
  }, [jobId, queryClient]);
}
