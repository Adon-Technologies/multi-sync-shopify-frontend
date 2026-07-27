import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type {
  FeedDataResponse,
  FeedMetadata,
  FeedStatus,
} from "../routes/app.feed-data";
import {
  feedKeys,
  generatePrimaryFeed,
  primaryFeedQueryOptions,
  type FeedQueryScope,
} from "../services/feed-query";
import styles from "../styles/feeds.module.css";

interface FeedsPanelProps {
  active: boolean;
  scope: FeedQueryScope | null;
}

const pendingStatuses = new Set<FeedStatus>(["QUEUED", "PROCESSING"]);

function isPendingFeed(data: FeedDataResponse | undefined) {
  return Boolean(
    data?.ok &&
      !data.backendUnavailable &&
      data.feed &&
      pendingStatuses.has(data.feed.status),
  );
}

function formatFileSize(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;

  const bytes = BigInt(value);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let divisor = 1n;

  while (
    unitIndex < units.length - 1 &&
    bytes >= divisor * 1_024n
  ) {
    divisor *= 1_024n;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${bytes.toString()} B`;
  const whole = Number((bytes * 10n) / divisor) / 10;
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(whole)} ${units[unitIndex]}`;
}

function formatRefreshDate(value: string, locale: string | null) {
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }
}

function statusLabel(status: FeedStatus) {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "PROCESSING":
      return "Generating";
    case "COMPLETED":
      return "Ready";
    case "FAILED":
      return "Failed";
    default:
      return "Not generated";
  }
}

function StatusBadge({ status }: { status: FeedStatus }) {
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

function LoadingRow() {
  return (
    <s-table-row>
      <s-table-cell>
        <span className={styles.loadingLine} />
      </s-table-cell>
      <s-table-cell>
        <span className={styles.loadingLine} />
      </s-table-cell>
      <s-table-cell>
        <span
          className={`${styles.loadingLine} ${styles.loadingLineWide}`}
        />
      </s-table-cell>
      <s-table-cell>
        <span className={styles.loadingLine} />
      </s-table-cell>
      <s-table-cell>
        <span className={styles.loadingLine} />
      </s-table-cell>
    </s-table-row>
  );
}

function generationProgress(feed: FeedMetadata) {
  if (feed.status === "QUEUED") {
    return "Waiting for the feed worker";
  }
  if (feed.status !== "PROCESSING") {
    return null;
  }
  if (feed.totalProducts && feed.totalProducts > 0) {
    return `${new Intl.NumberFormat().format(feed.processedProducts)} of ${new Intl.NumberFormat().format(feed.totalProducts)} products`;
  }

  return feed.processedProducts > 0
    ? `${new Intl.NumberFormat().format(feed.processedProducts)} products processed`
    : "Preparing catalog";
}

export function FeedsPanel({ active, scope }: FeedsPanelProps) {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "critical";
  } | null>(null);
  const wasActive = useRef(false);
  const endpoint = "/app/feed-data";
  const queryScope = scope ?? {
    locale: null,
    sessionId: "pending",
    shop: "pending",
  };
  const query = useQuery({
    ...primaryFeedQueryOptions(queryScope, endpoint),
    enabled: active && Boolean(scope),
    refetchInterval: (currentQuery) =>
      active && isPendingFeed(currentQuery.state.data)
        ? 2_000
        : false,
    refetchIntervalInBackground: false,
  });
  const mutation = useMutation({
    mutationFn: () => generatePrimaryFeed(endpoint),
    onSuccess: (data) => {
      if (scope) {
        queryClient.setQueryData(feedKeys.primary(scope, endpoint), data);
      }
      setFeedback(null);
    },
    onError: (error) => {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "Feed generation couldn't be started. Try again.",
        tone: "critical",
      });
    },
  });
  const queryData = query.data;
  const refetchFeed = query.refetch;

  useEffect(() => {
    if (active && !wasActive.current && queryData) {
      void refetchFeed();
    }
    wasActive.current = active;
  }, [active, queryData, refetchFeed]);

  const data = queryData?.ok ? queryData : null;
  const feed = data?.feed ?? null;
  const market = data?.market ?? null;
  const backendUnavailable = Boolean(data?.backendUnavailable);
  const generationInProgress = Boolean(
    feed && pendingStatuses.has(feed.status),
  );
  const successfulFeed = Boolean(
    feed?.gcsObjectName && feed.lastRefreshedAt,
  );
  const progress = feed ? generationProgress(feed) : null;

  const generate = async () => {
    if (
      !market ||
      generationInProgress ||
      mutation.isPending
    ) {
      return;
    }

    if (backendUnavailable) {
      const refreshed = await query.refetch();
      if (
        !refreshed.data?.ok ||
        refreshed.data.backendUnavailable
      ) {
        shopify.toast.show(
          "The feed service is unavailable. Please try again later.",
          { isError: true },
        );
        return;
      }
    }

    setFeedback(null);
    mutation.mutate();
  };

  const openFeed = () => {
    if (!feed?.publicUrl) return;
    const opened = window.open(
      feed.publicUrl,
      "_blank",
      "noopener,noreferrer",
    );
    if (opened) opened.opener = null;
  };

  const copyFeed = async () => {
    if (!feed?.publicUrl) return;

    try {
      await navigator.clipboard.writeText(feed.publicUrl);
      setFeedback(null);
      shopify.toast.show("Feed URL copied to the clipboard.");
    } catch {
      setFeedback({
        message: "The Feed URL couldn't be copied. Select and copy it manually.",
        tone: "critical",
      });
    }
  };

  return (
    <div className={styles.feeds}>
      <div className={styles.header}>
        <div>
          <s-heading>Feeds</s-heading>
          <s-paragraph color="subdued">
            Manage your primary Google feed and additional Shopify Markets
            feeds.
          </s-paragraph>
        </div>
      </div>

      {feedback ? (
        <s-banner heading={feedback.message} tone={feedback.tone} />
      ) : null}

      {query.isError ? (
        <s-banner heading="Feeds couldn't be loaded" tone="critical">
          <s-paragraph>
            {query.error instanceof Error
              ? query.error.message
              : "The feed service is unavailable."}
          </s-paragraph>
          <s-button
            loading={query.isFetching ? true : undefined}
            onClick={() => void query.refetch()}
            variant="secondary"
          >
            Try again
          </s-button>
        </s-banner>
      ) : null}

      {data?.marketUnavailable && !backendUnavailable ? (
        <s-banner heading="Shopify Market details may be outdated" tone="warning">
          The saved Primary Feed is still available, but Shopify didn&apos;t
          return current market details.
        </s-banner>
      ) : null}

      {feed?.status === "FAILED" && feed.lastError ? (
        <s-banner heading="Feed generation failed" tone="critical">
          {feed.lastError}
        </s-banner>
      ) : null}

      <s-section>
        <s-table>
          <s-table-header-row>
            <s-table-header format="base" listSlot="primary">
              <span className={styles.tableHeader}>Feed</span>
            </s-table-header>
            <s-table-header format="base" listSlot="labeled">
              <span className={styles.tableHeader}>Market</span>
            </s-table-header>
            <s-table-header format="base" listSlot="labeled">
              <span className={styles.tableHeader}>Feed URL</span>
            </s-table-header>
            <s-table-header format="base" listSlot="labeled">
              <span className={styles.tableHeader}>Last refresh</span>
            </s-table-header>
            <s-table-header format="base" listSlot="inline">
              <span className={styles.tableHeader}>Actions</span>
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {query.isPending && !data ? (
              <LoadingRow />
            ) : (
              <s-table-row>
                <s-table-cell>
                  <span className={styles.primaryLabel}>Primary feed</span>
                  {feed ? (
                    <span className={styles.statusStack}>
                      <StatusBadge status={feed.status} />
                      {progress ? (
                        <span className={styles.progressText}>{progress}</span>
                      ) : null}
                    </span>
                  ) : null}
                </s-table-cell>
                <s-table-cell>
                  {market ? (
                    <>
                      <span className={styles.primaryLabel}>{market.name}</span>
                      <span className={styles.marketDetails}>
                        {[
                          market.countryName ?? market.countryCode,
                          market.currencyCode,
                          market.locale.toLocaleUpperCase(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </>
                  ) : (
                    <span className={styles.secondaryText}>Unavailable</span>
                  )}
                </s-table-cell>
                <s-table-cell>
                  {successfulFeed && feed ? (
                    <span className={styles.feedUrl} title={feed.publicUrl}>
                      {feed.publicUrl}
                    </span>
                  ) : (
                    <span className={styles.secondaryText}>
                      Available after generation
                    </span>
                  )}
                </s-table-cell>
                <s-table-cell>
                  {feed?.lastRefreshedAt ? (
                    <>
                      <span className={styles.primaryLabel}>
                        {formatRefreshDate(
                          feed.lastRefreshedAt,
                          scope?.locale ?? null,
                        )}
                      </span>
                      <span className={styles.secondaryText}>
                        {formatFileSize(feed.fileSizeBytes) ?? "Size unavailable"}
                      </span>
                    </>
                  ) : (
                    <span className={styles.secondaryText}>
                      Never generated
                    </span>
                  )}
                </s-table-cell>
                <s-table-cell>
                  <div className={styles.actions}>
                    {successfulFeed && feed ? (
                      <>
                        <s-button
                          accessibilityLabel="Open Primary Feed in a new tab"
                          icon="external"
                          onClick={openFeed}
                          variant="secondary"
                        />
                        <s-button
                          accessibilityLabel="Refresh Primary Feed"
                          disabled={
                            generationInProgress ||
                            query.isFetching ||
                            mutation.isPending
                              ? true
                              : undefined
                          }
                          icon="refresh"
                          loading={
                            generationInProgress ||
                            query.isFetching ||
                            mutation.isPending
                              ? true
                              : undefined
                          }
                          onClick={() => void generate()}
                          variant="secondary"
                        />
                        <s-button
                          accessibilityLabel="Copy Primary Feed URL"
                          icon="clipboard"
                          onClick={() => void copyFeed()}
                          variant="secondary"
                        />
                      </>
                    ) : generationInProgress ? (
                      <s-button disabled loading variant="secondary">
                        Generating
                      </s-button>
                    ) : (
                      <s-button
                        disabled={
                          !market || query.isFetching || mutation.isPending
                            ? true
                            : undefined
                        }
                        loading={
                          query.isFetching || mutation.isPending
                            ? true
                            : undefined
                        }
                        onClick={() => void generate()}
                        variant="primary"
                      >
                        {feed?.status === "FAILED"
                          ? "Retry generation"
                          : "Generate XML feed"}
                      </s-button>
                    )}
                  </div>
                  <span aria-live="polite" className={styles.visuallyHidden}>
                    {generationInProgress ? progress : ""}
                  </span>
                </s-table-cell>
              </s-table-row>
            )}
          </s-table-body>
        </s-table>
      </s-section>
    </div>
  );
}
