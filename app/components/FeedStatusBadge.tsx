import type { FeedStatus } from "../routes/app.feed-data";

function statusLabel(status: FeedStatus) {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "PROCESSING":
      return "Generating";
    case "COMPLETED":
      return "Up to date";
    case "FAILED":
      return "Failed";
    default:
      return "Not generated";
  }
}

export function FeedStatusBadge({
  requiresRefresh,
  status,
}: {
  requiresRefresh: boolean;
  status: FeedStatus;
}) {
  if (status === "COMPLETED" && requiresRefresh) {
    return <s-badge tone="warning">Refresh required</s-badge>;
  }

  const tone =
    status === "COMPLETED"
      ? "success"
      : status === "FAILED"
        ? "critical"
        : status === "QUEUED" || status === "PROCESSING"
          ? "info"
          : "neutral";

  return <s-badge tone={tone}>{statusLabel(status)}</s-badge>;
}
