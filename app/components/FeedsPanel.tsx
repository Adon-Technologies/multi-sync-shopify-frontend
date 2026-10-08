import { PolarisSwitch } from "./PolarisSwitch";
import { useNavigate, useNavigation } from "react-router";
import { saveMarketConfiguration } from "../services/market-configuration-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GoPackage } from "react-icons/go";
import { TbFileTypeXml } from "react-icons/tb";

import type {
  AdditionalFeedActionResponse,
  AdditionalFeedEntry,
  AdditionalFeedsResponse,
} from "../routes/app.additional-feeds";
import type {
  FeedDataResponse,
  FeedMetadata,
  FeedStatus,
} from "../routes/app.feed-data";
import {
  configurationKeys,
  configurationQueryOptions,
  type ConfigurationResponse,
} from "../services/configuration-query";
import {
  additionalFeedsQueryOptions,
  deleteAdditionalFeed,
  feedKeys,
  generatePrimaryFeed,
  primaryFeedQueryOptions,
  refreshAdditionalFeed,
  refreshAllFeeds,
  refreshAllStatusQueryOptions,
  type FeedQueryScope,
} from "../services/feed-query";
import { useHydrated } from "../hooks/useHydrated";
import {
  formatFeedGenerationProgress as generationProgress,
  shouldPollPrimaryFeed,
} from "../services/feed-generation-state";
import styles from "../styles/feeds.module.css";
import { AutomaticRefreshCard } from "./AutomaticRefreshCard";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { TabAlertNavigator, type TabAlert } from "./TabAlertNavigator";

interface FeedsPanelProps {
  active: boolean;
  scope: FeedQueryScope | null;
}

const pendingStatuses = new Set<FeedStatus>(["QUEUED", "PROCESSING"]);

function isSuccessfulFeedData(
  data: FeedDataResponse | undefined,
): data is Extract<FeedDataResponse, { ok: true }> {
  return data?.ok === true;
}

function hasPendingAdditionalFeeds(
  data:
    | {
        activeGeneration?: unknown;
        feeds?: AdditionalFeedEntry[];
        ok?: boolean;
      }
    | undefined,
) {
  return Boolean(
    data?.ok &&
    (data.activeGeneration ||
      data.feeds?.some(({ feed }) => pendingStatuses.has(feed.status))),
  );
}

function formatFileSize(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;

  const bytes = BigInt(value);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let divisor = 1n;

  while (unitIndex < units.length - 1 && bytes >= divisor * 1_024n) {
    divisor *= 1_024n;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${bytes.toString()} B`;
  const whole = Number((bytes * 10n) / divisor) / 10;
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(whole)} ${units[unitIndex]}`;
}

function FeedFileDetails({ feed }: { feed: FeedMetadata }) {
  return (
    <span className={styles.feedFileDetails}>
      <span className={styles.feedFileDetail}>
        <GoPackage aria-hidden="true" />
        {new Intl.NumberFormat().format(feed.generatedItems)} out of{" "}
        {new Intl.NumberFormat().format(feed.processedVariants)} variants
      </span>
      <span className={styles.feedFileDetail}>
        <TbFileTypeXml aria-hidden="true" />
        {formatFileSize(feed.fileSizeBytes) ?? "Size unavailable"}
      </span>
      <span className={styles.feedFileDetail}>Format: XML</span>
    </span>
  );
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
        <span className={`${styles.loadingLine} ${styles.loadingLineWide}`} />
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

export function FeedsPanel({ active, scope }: FeedsPanelProps) {
  const hydrated = useHydrated();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const openingMarket =
    navigation.state !== "idle" &&
    navigation.location?.pathname === "/app/market-feed/new";
  const toggleInFlight = useRef(false);
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "critical";
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdditionalFeedEntry | null>(
    null,
  );
  const [automaticWorkActive, setAutomaticWorkActive] = useState(false);
  const [automaticRefreshAlerts, setAutomaticRefreshAlerts] = useState<
    TabAlert[]
  >([]);
  const [refreshAllRunId, setRefreshAllRunId] = useState<string | null>(null);
  const wasActive = useRef(false);
  const previousFeedRefreshRequired = useRef<boolean | null>(null);
  const endpoint = "/app/feed-data";
  const additionalEndpoint = "/app/additional-feeds";
  const queryScope = scope ?? {
    locale: null,
    sessionId: "pending",
    shop: "pending",
  };
  const synchronizeConfigurationRefreshState = useCallback(
    async (feedsAreFresh = false) => {
      if (!scope) return;

      const queryKey = configurationKeys.configuration(scope);
      if (feedsAreFresh) {
        queryClient.setQueryData<ConfigurationResponse>(queryKey, (current) =>
          current
            ? {
                ...current,
                feedRefreshRequired: false,
              }
            : current,
        );
        return;
      }

      try {
        await queryClient.fetchQuery({
          ...configurationQueryOptions(scope),
          staleTime: 0,
        });
      } catch {
        await queryClient.invalidateQueries({
          queryKey,
          refetchType: "none",
        });
      }
    },
    [queryClient, scope],
  );
  const query = useQuery({
    ...primaryFeedQueryOptions(queryScope, endpoint),
    enabled: active && Boolean(scope),
    refetchInterval: (currentQuery) =>
      active && shouldPollPrimaryFeed(currentQuery.state.data) ? 2_000 : false,
    refetchIntervalInBackground: false,
  });
  const additionalQuery = useQuery({
    ...additionalFeedsQueryOptions(queryScope, additionalEndpoint),
    enabled: active && Boolean(scope),
    refetchInterval: (currentQuery) =>
      active && hasPendingAdditionalFeeds(currentQuery.state.data)
        ? 2_000
        : active &&
            currentQuery.state.data?.ok &&
            currentQuery.state.data.usage?.status === "PENDING"
          ? 10_000
          : false,
    refetchIntervalInBackground: false,
  });
  const refreshAllStatusQuery = useQuery({
    ...refreshAllStatusQueryOptions(queryScope, refreshAllRunId ?? "pending"),
    enabled: active && Boolean(scope) && Boolean(refreshAllRunId),
    refetchInterval: (currentQuery) => {
      const status = currentQuery.state.data?.status;
      return status === "SUCCESS" ||
        status === "PARTIALLY_FAILED" ||
        status === "FAILED"
        ? false
        : 2_000;
    },
    refetchIntervalInBackground: false,
  });
  const refetchAdditionalFeeds = additionalQuery.refetch;
  const invalidateFeedQueries = async () => {
    if (!scope) return;
    await queryClient.invalidateQueries({
      queryKey: feedKeys.all(scope),
    });
  };
  const applyAdditionalActionResult = (
    result: AdditionalFeedActionResponse,
  ) => {
    if (!scope || !result.ok) return;
    queryClient.setQueryData<AdditionalFeedsResponse>(
      feedKeys.additional(scope, additionalEndpoint),
      (current) => {
        if (!current?.ok || !result.entry) return current;
        const feeds = current.feeds.some(
          ({ feed }) => feed.id === result.entry?.feed.id,
        )
          ? current.feeds.map((entry) =>
              entry.feed.id === result.entry?.feed.id ? result.entry! : entry,
            )
          : [...current.feeds, result.entry];

        return {
          ...current,
          activeGeneration: result.activeGeneration ?? current.activeGeneration,
          feeds,
        };
      },
    );
  };
  const mutation = useMutation({
    mutationFn: () => generatePrimaryFeed(endpoint),
    onSuccess: (data) => {
      if (scope) {
        queryClient.setQueryData(feedKeys.primary(scope, endpoint), data);
        void queryClient.invalidateQueries({
          queryKey: feedKeys.additional(scope, additionalEndpoint),
        });
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
  const toggleMutation = useMutation({
    mutationFn: (input: { feedId: string; customConfigurationEnabled: boolean; expectedRevision: number }) => saveMarketConfiguration(input, true),
    onSuccess: (result) => {
      applyAdditionalActionResult(result);
      setFeedback(null);
      void invalidateFeedQueries();
      void synchronizeConfigurationRefreshState();
      shopify.toast.show("Configuration mode saved. Refresh this feed to apply changes.");
    },
    onError: (error) => {
      setFeedback({ message: error.message, tone: "critical" });
      void invalidateFeedQueries();
    },
    onSettled: () => { toggleInFlight.current = false; },
  });
  const additionalRefreshMutation = useMutation({
    mutationFn: (feedId: string) =>
      refreshAdditionalFeed(feedId, additionalEndpoint),
    onSuccess: (result) => {
      applyAdditionalActionResult(result);
      setFeedback(null);
      void invalidateFeedQueries();
      shopify.toast.show("Feed refresh started.");
    },
    onError: (error) => {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "The feed refresh couldn't be started.",
        tone: "critical",
      });
    },
  });
  const refreshAllMutation = useMutation({
    mutationFn: () => refreshAllFeeds(),
    onSuccess: (result) => {
      setFeedback(null);
      setRefreshAllRunId(result.runId);
      if (scope) {
        queryClient.setQueryData<FeedDataResponse>(
          feedKeys.primary(scope, endpoint),
          (current) =>
            current?.ok
              ? {
                  ...current,
                  activeGeneration: result.activeGeneration,
                }
              : current,
        );
        queryClient.setQueryData<AdditionalFeedsResponse>(
          feedKeys.additional(scope, additionalEndpoint),
          (current) =>
            current?.ok
              ? {
                  ...current,
                  activeGeneration: result.activeGeneration,
                }
              : current,
        );
      }
      void invalidateFeedQueries();
      shopify.toast.show(
        `Refreshing ${result.totalFeeds} XML ${
          result.totalFeeds === 1 ? "feed" : "feeds"
        }.`,
      );
    },
    onError: (error) => {
      setRefreshAllRunId(null);
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "The XML refresh couldn't be started.",
        tone: "critical",
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (feedId: string) =>
      deleteAdditionalFeed(feedId, additionalEndpoint),
    onSuccess: () => {
      setFeedback(null);
      setDeleteTarget(null);
      void invalidateFeedQueries();
      shopify.toast.show("Additional Market feed deleted.");
    },
    onError: (error) => {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "The additional feed couldn't be deleted.",
        tone: "critical",
      });
    },
  });
  const queryData = query.data;
  const refetchFeed = query.refetch;

  useEffect(() => {
    if (active && !wasActive.current) {
      if (queryData) void refetchFeed();
      if (additionalQuery.data) void refetchAdditionalFeeds();
    }
    wasActive.current = active;
  }, [
    active,
    additionalQuery.data,
    queryData,
    refetchAdditionalFeeds,
    refetchFeed,
  ]);

  const data = isSuccessfulFeedData(queryData) ? queryData : null;
  const feed = data?.feed ?? null;
  const market = data?.market ?? null;
  const additionalData =
    additionalQuery.data && additionalQuery.data.ok === true
      ? additionalQuery.data
      : null;
  const additionalFeeds = useMemo(
    () => additionalData?.feeds ?? [],
    [additionalData],
  );
  const additionalUsage = additionalData?.usage;
  const entitlements = additionalUsage?.entitlements;

  const feedRefreshRequired = Boolean(
    feed?.requiresRefresh ||
    additionalFeeds.some(({ feed: candidate }) => candidate.requiresRefresh),
  );
  useEffect(() => {
    const previous = previousFeedRefreshRequired.current;
    previousFeedRefreshRequired.current = feedRefreshRequired;
    if (previous === true && !feedRefreshRequired) {
      void synchronizeConfigurationRefreshState(true);
    }
  }, [feedRefreshRequired, synchronizeConfigurationRefreshState]);
  const visibleAdditionalFeeds = additionalFeeds;
  const backendUnavailable = Boolean(data?.backendUnavailable);
  const primaryGenerationInProgress = Boolean(
    feed && pendingStatuses.has(feed.status),
  );
  const generationInProgress = Boolean(
    primaryGenerationInProgress ||
    data?.activeGeneration ||
    additionalData?.activeGeneration ||
    additionalFeeds.some(({ feed: candidate }) =>
      pendingStatuses.has(candidate.status),
    ),
  );
  const generationLocked =
    automaticWorkActive ||
    Boolean(refreshAllRunId) ||
    generationInProgress ||
    mutation.isPending ||
    additionalRefreshMutation.isPending ||
    refreshAllMutation.isPending;
  const successfulFeed = Boolean(feed?.gcsObjectName && feed.lastRefreshedAt);
  const hasRefreshableFeeds =
    successfulFeed ||
    additionalFeeds.some(({ feed: candidate }) =>
      Boolean(candidate.gcsObjectName && candidate.lastRefreshedAt),
    );
  const progress = feed
    ? generationProgress(feed, entitlements?.productLimit)
    : null;



  useEffect(() => {
    const result = refreshAllStatusQuery.data;
    if (
      !refreshAllRunId ||
      !result ||
      (result.status !== "SUCCESS" &&
        result.status !== "PARTIALLY_FAILED" &&
        result.status !== "FAILED")
    ) {
      return;
    }

    setRefreshAllRunId(null);
    void Promise.all([
      refetchFeed(),
      refetchAdditionalFeeds(),
      synchronizeConfigurationRefreshState(result.status === "SUCCESS"),
    ]);

    if (result.status === "SUCCESS") {
      shopify.toast.show(
        `All ${result.completedFeeds} XML ${
          result.completedFeeds === 1 ? "feed was" : "feeds were"
        } refreshed.`,
      );
      return;
    }

    setFeedback({
      message:
        result.runError ??
        `${result.failedFeeds} XML ${
          result.failedFeeds === 1 ? "feed" : "feeds"
        } could not be refreshed.`,
      tone: "critical",
    });
  }, [
    refreshAllRunId,
    refreshAllStatusQuery.data,
    synchronizeConfigurationRefreshState,
    refetchAdditionalFeeds,
    refetchFeed,
    shopify,
  ]);

  const generate = async () => {
    if (!market || generationLocked || mutation.isPending) {
      return;
    }

    if (backendUnavailable) {
      const refreshed = await query.refetch();
      if (!refreshed.data?.ok || refreshed.data.backendUnavailable) {
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
    const opened = window.open(feed.publicUrl, "_blank", "noopener,noreferrer");
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
        message:
          "The Feed URL couldn't be copied. Select and copy it manually.",
        tone: "critical",
      });
    }
  };

  const copyAdditionalFeed = async (entry: AdditionalFeedEntry) => {
    try {
      await navigator.clipboard.writeText(entry.feed.publicUrl);
      setFeedback(null);
      shopify.toast.show("Feed URL copied to the clipboard.");
    } catch {
      setFeedback({
        message:
          "The Feed URL couldn't be copied. Select and copy it manually.",
        tone: "critical",
      });
    }
  };

  const tabAlerts: TabAlert[] = [];
  if (feedback) {
    tabAlerts.push({
      heading: feedback.message,
      id: "feed-feedback",
      tone: feedback.tone,
    });
  }
  if (refreshAllRunId && refreshAllStatusQuery.isError) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: refreshAllStatusQuery.isFetching,
      heading: "XML refresh status couldn't be loaded",
      id: "refresh-all-status",
      message:
        refreshAllStatusQuery.error instanceof Error
          ? refreshAllStatusQuery.error.message
          : "Try loading the refresh status again.",
      onAction: () => void refreshAllStatusQuery.refetch(),
      tone: "critical",
    });
  }
  if (query.isError) {
    tabAlerts.push({
      actionLabel: "Try again",
      actionLoading: query.isFetching,
      heading: "Feeds couldn't be loaded",
      id: "primary-feed-load",
      message:
        query.error instanceof Error
          ? query.error.message
          : "The feed service is unavailable.",
      onAction: () => void query.refetch(),
      tone: "critical",
    });
  }
  if (additionalQuery.isError) {
    tabAlerts.push({
      actionLabel: "Try again",
      actionLoading: additionalQuery.isFetching,
      heading: "Additional Market feeds couldn't be loaded",
      id: "additional-feeds-load",
      message:
        additionalQuery.error instanceof Error
          ? additionalQuery.error.message
          : "The feed service is unavailable.",
      onAction: () => void additionalQuery.refetch(),
      tone: "critical",
    });
  }
  if (data?.marketUnavailable && !backendUnavailable) {
    tabAlerts.push({
      heading: "Shopify Market details may be outdated",
      id: "market-details-warning",
      message:
        "The saved Primary Feed is still available, but Shopify didn't return current market details.",
      tone: "warning",
    });
  }
  if (feed?.status === "FAILED" && feed.lastError) {
    tabAlerts.push({
      heading: "Feed generation failed",
      id: "primary-feed-generation",
      message: feed.lastError,
      tone: "critical",
    });
  }
  tabAlerts.push(...automaticRefreshAlerts);

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
        <s-button
          accessibilityLabel="Refresh all XML feeds"
          disabled={
            !scope ||
            !hasRefreshableFeeds ||
            backendUnavailable ||
            additionalData?.backendUnavailable ||
            generationLocked
              ? true
              : undefined
          }
          icon="refresh"
          loading={
            refreshAllMutation.isPending || Boolean(refreshAllRunId)
              ? true
              : undefined
          }
          onClick={() => refreshAllMutation.mutate()}
          variant="primary"
        >
          Refresh all XMLs
        </s-button>
      </div>

      <TabAlertNavigator alerts={tabAlerts} />

      <s-section>
        <div className={styles.feedTable}>
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
                    <span
                      className={`${styles.primaryLabel} ${styles.feedName}`}
                    >
                      Primary feed
                    </span>
                    {feed ? (
                      <span className={styles.statusStack}>
                        <FeedStatusBadge
                          requiresRefresh={feed.requiresRefresh}
                          status={feed.status}
                        />
                        {progress ? (
                          <span className={styles.progressText}>
                            {progress}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </s-table-cell>
                  <s-table-cell>
                    {market ? (
                      <>
                        <span className={styles.primaryLabel}>
                          {market.name}
                        </span>
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
                      <>
                        <a
                          className={styles.feedUrl}
                          href={feed.publicUrl}
                          rel="noreferrer"
                          target="_blank"
                          title={feed.publicUrl}
                        >
                          {feed.publicUrl}
                        </a>
                        <FeedFileDetails feed={feed} />
                      </>
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
                            interestFor="primary-feed-open-tooltip"
                            onClick={openFeed}
                            variant="secondary"
                          />
                          <s-tooltip id="primary-feed-open-tooltip">
                            Open
                          </s-tooltip>
                          <s-button
                            accessibilityLabel="Refresh Primary Feed"
                            disabled={
                              generationLocked ||
                              query.isFetching ||
                              mutation.isPending
                                ? true
                                : undefined
                            }
                            icon="refresh"
                            interestFor="primary-feed-refresh-tooltip"
                            loading={
                              primaryGenerationInProgress || mutation.isPending
                                ? true
                                : undefined
                            }
                            onClick={() => void generate()}
                            variant="secondary"
                          />
                          <s-tooltip id="primary-feed-refresh-tooltip">
                            Refresh XML
                          </s-tooltip>
                          <s-button
                            accessibilityLabel="Copy Primary Feed URL"
                            icon="clipboard"
                            interestFor="primary-feed-copy-tooltip"
                            onClick={() => void copyFeed()}
                            variant="secondary"
                          />
                          <s-tooltip id="primary-feed-copy-tooltip">
                            Copy
                          </s-tooltip>
                        </>
                      ) : primaryGenerationInProgress ? (
                        <s-button disabled loading variant="secondary">
                          Generating
                        </s-button>
                      ) : (
                        <s-button
                          disabled={
                            !market ||
                            generationLocked ||
                            query.isFetching ||
                            mutation.isPending
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
                      {primaryGenerationInProgress ? progress : ""}
                    </span>
                  </s-table-cell>
                </s-table-row>
              )}
            </s-table-body>
          </s-table>
        </div>
      </s-section>

      <s-section>
        <div className={styles.additionalHeader}>
          <div>
            <s-heading>Additional Market feeds</s-heading>
            <s-paragraph color="subdued">
              Create localized Google feeds for specific Shopify Markets,
              countries, currencies, and languages.
            </s-paragraph>
          </div>
          <s-button
            disabled={
              additionalData?.backendUnavailable ||
              generationLocked ||
              openingMarket
                ? true
                : undefined
            }
            loading={openingMarket ? true : undefined}
            onClick={() => navigate("/app/market-feed/new")}
            variant="primary"
          >
            + Add Market
          </s-button>
        </div>

        {entitlements ? (
          <s-paragraph color="subdued">
            Includes {entitlements.includedAdditionalFeeds} Additional Market{" "}
            {entitlements.includedAdditionalFeeds === 1 ? "feed" : "feeds"}.
            Additional feeds are ${(entitlements.additionalFeedPriceCents / 100).toFixed(2)}/month each.
            {entitlements.productLimit !== null
              ? ` Each feed includes up to ${entitlements.productLimit} eligible products and their eligible variants.`
              : " Products and variants are unlimited."}
          </s-paragraph>
        ) : null}
        {additionalUsage?.message ? (
          <s-banner
            tone={additionalUsage.status === "TRIAL" ? "info" : "warning"}
          >
            {additionalUsage.message}
          </s-banner>
        ) : null}

        {additionalQuery.isPending && !additionalData ? (
          <div className={styles.feedTable}>
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
                <LoadingRow />
              </s-table-body>
            </s-table>
          </div>
        ) : visibleAdditionalFeeds.length === 0 ? (
          <div className={styles.emptyState}>
            <s-heading>No additional market feeds</s-heading>
            <s-paragraph color="subdued">
              Create localized Google feeds for specific Shopify Markets,
              countries, currencies, and languages.
            </s-paragraph>
          </div>
        ) : (
          <div className={styles.feedTable}>
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
                <s-table-header format="base" listSlot="labeled">
                  <span className={styles.customConfigurationHeader}>
                    <span className={styles.tableHeader}>Custom configuration</span>
                    <s-clickable
                      accessibilityLabel="About custom configuration"
                      interestFor="custom-configuration-tooltip"
                      inlineSize="20px"
                      padding="none"
                      borderRadius="base"
                    >
                      <s-icon type="info" color="subdued" />
                    </s-clickable>
                    <s-tooltip id="custom-configuration-tooltip">
                      On: Use separate settings for this market feed. Off: Follow
                      the Primary Feed configuration, including future changes.
                      Your saved custom settings are kept when turned off. Color,
                      size, gender, and age always follow Primary. Refresh the
                      feed to apply changes.
                    </s-tooltip>
                  </span>
                </s-table-header>
                <s-table-header format="base" listSlot="inline">
                  <span className={styles.tableHeader}>Actions</span>
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {visibleAdditionalFeeds.map((entry) => {
                  const candidate = entry.feed;
                  const candidatePending = pendingStatuses.has(
                    candidate.status,
                  );
                  const candidateDeleting =
                    deleteMutation.isPending &&
                    deleteMutation.variables === candidate.id;
                  const candidateReady = Boolean(
                    candidate.gcsObjectName && candidate.lastRefreshedAt,
                  );
                  const candidateProgress = generationProgress(
                    candidate,
                    entitlements?.productLimit,
                  );

                  return (
                    <s-table-row key={candidate.id}>
                      <s-table-cell>
                        <span
                          className={`${styles.primaryLabel} ${styles.feedName}`}
                        >
                          Additional feed
                        </span>
                        <span className={styles.statusStack}>
                          <FeedStatusBadge
                            requiresRefresh={candidate.requiresRefresh}
                            status={candidate.status}
                          />
                          {candidateProgress ? (
                            <span className={styles.progressText}>
                              {candidateProgress}
                            </span>
                          ) : null}
                          {candidate.status === "FAILED" &&
                          candidate.lastError ? (
                            <span className={styles.rowError}>
                              {candidate.lastError}
                            </span>
                          ) : null}
                        </span>
                      </s-table-cell>
                      <s-table-cell>
                        <span className={styles.primaryLabel}>
                          {entry.market.name}
                        </span>
                        <span className={styles.marketDetails}>
                          {[
                            entry.market.countryName ??
                              entry.market.countryCode,
                            entry.market.currencyCode,
                            entry.market.locale.toUpperCase(),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </s-table-cell>
                      <s-table-cell>
                        {candidateReady ? (
                          <>
                            <a
                              className={styles.feedUrl}
                              href={candidate.publicUrl}
                              rel="noreferrer"
                              target="_blank"
                              title={candidate.publicUrl}
                            >
                              {candidate.publicUrl}
                            </a>
                            <FeedFileDetails feed={candidate} />
                          </>
                        ) : (
                          <span className={styles.secondaryText}>
                            Available after generation
                          </span>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {candidate.lastRefreshedAt ? (
                          <>
                            <span className={styles.primaryLabel}>
                              {formatRefreshDate(
                                candidate.lastRefreshedAt,
                                scope?.locale ?? null,
                              )}
                            </span>
                          </>
                        ) : (
                          <span className={styles.secondaryText}>
                            Never generated
                          </span>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <div className={styles.customConfigurationSwitch}>
                        <PolarisSwitch label={`Custom configuration for ${entry.market.name} ${entry.market.locale}`}
                          labelAccessibilityVisibility="exclusive"
                          checked={candidate.customConfigurationEnabled === true}
                          disabled={candidatePending || toggleMutation.isPending || additionalData?.backendUnavailable}
                          onChange={enabled => {
                            if (toggleInFlight.current) return;
                            toggleInFlight.current = true;
                            toggleMutation.mutate({ feedId: candidate.id, customConfigurationEnabled: enabled, expectedRevision: candidate.marketConfigurationRevision ?? 0 });
                          }} />
                        </div>
                      </s-table-cell>
                      <s-table-cell>
                        <div className={styles.actions}>
                          <s-button
                            accessibilityLabel={`Edit ${entry.market.name} ${entry.market.locale} configuration`}
                            icon="edit"
                            interestFor={`additional-feed-${candidate.id}-edit-tooltip`}
                            disabled={
                              candidatePending ||
                              additionalData?.backendUnavailable
                                ? true
                                : undefined
                            }
                            onClick={() => navigate(`/app/market-feed/${candidate.id}`)}
                            variant="secondary"
                          />
                          <s-tooltip
                            id={`additional-feed-${candidate.id}-edit-tooltip`}
                          >
                            Edit configuration
                          </s-tooltip>
                          {candidateReady ? (
                            <>
                              <s-button
                                accessibilityLabel={`Open ${entry.market.name} ${entry.market.countryName ?? ""} ${entry.market.locale} feed in a new tab`}
                                icon="external"
                                interestFor={`additional-feed-${candidate.id}-open-tooltip`}
                                onClick={() => {
                                  const opened = window.open(
                                    candidate.publicUrl,
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                                  if (opened) opened.opener = null;
                                }}
                                variant="secondary"
                              />
                              <s-tooltip
                                id={`additional-feed-${candidate.id}-open-tooltip`}
                              >
                                Open
                              </s-tooltip>
                              <s-button
                                accessibilityLabel={`Refresh ${entry.market.name} ${entry.market.locale} feed`}
                                disabled={
                                  generationLocked ||
                                  additionalRefreshMutation.isPending
                                    ? true
                                    : undefined
                                }
                                icon="refresh"
                                interestFor={`additional-feed-${candidate.id}-refresh-tooltip`}
                                loading={
                                  candidatePending ||
                                  (additionalRefreshMutation.isPending &&
                                    additionalRefreshMutation.variables ===
                                      candidate.id)
                                    ? true
                                    : undefined
                                }
                                onClick={() =>
                                  additionalRefreshMutation.mutate(candidate.id)
                                }
                                variant="secondary"
                              />
                              <s-tooltip
                                id={`additional-feed-${candidate.id}-refresh-tooltip`}
                              >
                                Refresh XML
                              </s-tooltip>
                              <s-button
                                accessibilityLabel={`Copy ${entry.market.name} ${entry.market.locale} feed URL`}
                                icon="clipboard"
                                interestFor={`additional-feed-${candidate.id}-copy-tooltip`}
                                onClick={() => void copyAdditionalFeed(entry)}
                                variant="secondary"
                              />
                              <s-tooltip
                                id={`additional-feed-${candidate.id}-copy-tooltip`}
                              >
                                Copy
                              </s-tooltip>
                            </>
                          ) : candidatePending ? (
                            <s-button disabled loading variant="secondary">
                              Generating
                            </s-button>
                          ) : (
                            <s-button
                              disabled={
                                generationLocked ||
                                additionalRefreshMutation.isPending
                                  ? true
                                  : undefined
                              }
                              onClick={() =>
                                additionalRefreshMutation.mutate(candidate.id)
                              }
                              variant="primary"
                            >
                              Retry generation
                            </s-button>
                          )}
                          <s-button
                            accessibilityLabel={`Delete ${entry.market.name} ${entry.market.countryName ?? ""} ${entry.market.locale} feed`}
                            command="--show"
                            commandFor="delete-additional-feed-modal"
                            disabled={
                              generationLocked ||
                              candidatePending ||
                              (deleteMutation.isPending && !candidateDeleting)
                                ? true
                                : undefined
                            }
                            icon="delete"
                            loading={candidateDeleting ? true : undefined}
                            onClick={() => setDeleteTarget(entry)}
                            tone="critical"
                            variant="secondary"
                          />
                        </div>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </div>
        )}

      </s-section>

      <AutomaticRefreshCard
        active={active}
        key={
          scope
            ? `${scope.shop}:${scope.sessionId}`
            : "pending-feed-refresh-schedule"
        }
        onActivityChange={setAutomaticWorkActive}
        onAlertsChange={setAutomaticRefreshAlerts}
        scope={scope}
      />

      <s-modal
        accessibilityLabel="Delete additional Market feed confirmation"
        heading="Delete additional Market feed?"
        id="delete-additional-feed-modal"
        onHide={hydrated ? () => setDeleteTarget(null) : undefined}
      >
        <s-paragraph>
          {deleteTarget
            ? `Delete ${deleteTarget.market.name} / ${deleteTarget.market.countryName ?? deleteTarget.market.countryCode} / ${deleteTarget.market.languageName ?? deleteTarget.market.locale.toUpperCase()}?`
            : "Delete this additional Market feed?"}
        </s-paragraph>
        <s-paragraph color="subdued">
          Its XML file will be removed from cloud storage and the public URL
          will stop working. This cannot be undone.
        </s-paragraph>
        <s-button
          command="--hide"
          commandFor="delete-additional-feed-modal"
          disabled={
            !deleteTarget || generationLocked || deleteMutation.isPending
              ? true
              : undefined
          }
          loading={deleteMutation.isPending ? true : undefined}
          onClick={() => {
            if (deleteTarget) {
              deleteMutation.mutate(deleteTarget.feed.id);
            }
          }}
          slot="primary-action"
          tone="critical"
          variant="primary"
        >
          Delete feed
        </s-button>
        <s-button
          command="--hide"
          commandFor="delete-additional-feed-modal"
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}
