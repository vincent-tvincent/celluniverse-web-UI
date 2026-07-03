export function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return error.name === "AbortError" || message.includes("signal is aborted") || message.includes("operation was aborted");
  }
  return false;
}

export function userFacingViewerError(error: unknown): Error | null {
  return isAbortLikeError(error) ? null : error instanceof Error ? error : null;
}
