const pendingStatuses = new Set(["QUEUED", "PROCESSING"]);

export function formatFeedGenerationProgress(
  feed: {
    status: string;
    processedProducts: number;
    totalProducts: number | null;
  },
  productLimit: number | null = null,
) {
  if (feed.status === "QUEUED") return "Waiting for the feed worker";
  if (feed.status !== "PROCESSING") return null;
  const format = (value: number) => new Intl.NumberFormat().format(value);
  if (productLimit !== null) {
    const progress =
      feed.processedProducts > 0
        ? `${format(feed.processedProducts)} products checked`
        : "Finding eligible products";
    return `${progress} · Up to ${format(productLimit)} products per feed`;
  }
  if (feed.totalProducts && feed.totalProducts > 0) {
    return `${format(feed.processedProducts)} of ${format(feed.totalProducts)} products`;
  }
  return feed.processedProducts > 0
    ? `${format(feed.processedProducts)} products processed`
    : "Preparing catalog";
}

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
