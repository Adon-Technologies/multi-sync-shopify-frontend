const pendingStatuses = new Set(["QUEUED", "PROCESSING"]);

interface PollablePrimaryFeedData {
  activeGeneration?: unknown;
  backendUnavailable?: boolean;
  feed?: { status: string } | null;
  ok: boolean;
}

export function shouldPollPrimaryFeed(
  data: PollablePrimaryFeedData | undefined,
) {
  return Boolean(
    data?.ok &&
      !data.backendUnavailable &&
      (data.activeGeneration ||
        (data.feed && pendingStatuses.has(data.feed.status))),
  );
}
