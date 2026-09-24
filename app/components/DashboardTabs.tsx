import {
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Await, useLocation, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useQuery } from "@tanstack/react-query";
import { HiHome } from "react-icons/hi2";
import { IoMdSettings } from "react-icons/io";
import { MdOutlineCreditCard, MdOutlineSupportAgent } from "react-icons/md";
import { SiGoogleanalytics } from "react-icons/si";
import { TbFileTypeXml } from "react-icons/tb";

import { InlineLoadingValue } from "./DashboardStates";
import {
  BillingAccessGate,
  InactivePlanBanner,
  SubscriptionBanner,
  SubscriptionPanel,
  useSubscription,
} from "./SubscriptionStatus";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ConfigurationsPanel } from "./ConfigurationsPanel";
import { FeedsPanel } from "./FeedsPanel";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { TabAlertNavigator, type TabAlert } from "./TabAlertNavigator";
import { SupportPanel } from "./SupportPanel";
import { PlanReviewBanner } from "./ReviewBanner";
import type {
  ProductStatistics,
  StoreInformation,
} from "../services/dashboard.server";
import type { AdditionalFeedsResponse } from "../routes/app.additional-feeds";
import type { FeedDataResponse } from "../routes/app.feed-data";
import { configurationQueryOptions } from "../services/configuration-query";
import type { DiagnosticsQueryScope } from "../services/diagnostics-query";
import {
  additionalFeedsQueryOptions,
  primaryFeedQueryOptions,
  type FeedQueryScope,
} from "../services/feed-query";
import type { SubscriptionView } from "../billing/types";
import {
  appSections,
  dashboardTabFromLocation,
  dashboardTabHref,
  parseDashboardTab,
  type DashboardTabId,
} from "../services/app-navigation";
import styles from "../styles/dashboard.module.css";

const tabIcons = {
  dashboard: HiHome,
  feeds: TbFileTypeXml,
  diagnostics: SiGoogleanalytics,
  configurations: IoMdSettings,
  support: MdOutlineSupportAgent,
  plan: MdOutlineCreditCard,
};
const tabs = appSections.map((section) => ({
  ...section,
  icon: tabIcons[section.id],
}));
type SectionState = "loading" | "ready" | "error";
type StatisticKey = Exclude<keyof ProductStatistics, "generatedAt">;

interface DashboardTabsProps {
  diagnosticsScope: DiagnosticsQueryScope | null;
  feedScope: FeedQueryScope | null;
  initialTab?: DashboardTabId;
  initialSubscription: SubscriptionView | null;
  statistics: Promise<ProductStatistics>;
  storeInformation: Promise<StoreInformation>;
  isRefreshing: boolean;
  onRefresh: () => void;
  planSelectionUrl: string | null;
}

interface DashboardPanelContentProps extends DashboardTabsProps {
  active: boolean;
  onOpenFeeds: () => void;
}

interface StatisticsTableProps {
  statistics?: ProductStatistics;
  state: SectionState;
}

interface StoreInformationProps {
  alertsEmail?: string | null;
  alertsEmailState: SectionState;
  store?: StoreInformation;
  state: SectionState;
}

interface FeedOverviewProps {
  additional?: AdditionalFeedsResponse;
  primary?: FeedDataResponse;
  state: SectionState;
}

interface DashboardSectionResultProps {
  children: ReactNode;
  failed: boolean;
  onStateChange: (failed: boolean) => void;
}

function activeTabStorageKey(shop: string) {
  return `multi-sync:${shop}:active-tab`;
}

function storedActiveTab(shop: string) {
  try {
    return window.localStorage.getItem(activeTabStorageKey(shop));
  } catch {
    return null;
  }
}

function persistActiveTab(tabId: DashboardTabId, shop?: string) {
  if (typeof window === "undefined") return;

  if (shop) {
    try {
      window.localStorage.setItem(activeTabStorageKey(shop), tabId);
    } catch {
      // The URL remains the primary persistence mechanism when embedded
      // browser storage is unavailable.
    }
  }
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function StatisticsTable({ statistics, state }: StatisticsTableProps) {
  const rows: Array<{ key: StatisticKey; label: string }> = [
    { key: "totalProducts", label: "Total products" },
    { key: "publishedProducts", label: "Published products" },
    {
      key: "publishedProductVariants",
      label: "Published product variants",
    },
    { key: "unpublishedProducts", label: "Unpublished products" },
    { key: "draftProducts", label: "Draft products" },
  ];

  return (
    <s-stack gap="base">
      {state !== "error" && statistics?.totalProducts === 0 ? (
        <s-banner heading="No products found" tone="info">
          Product statistics will appear here after products are added to this
          store.
        </s-banner>
      ) : statistics?.publishedProducts === 0 ? (
        <s-banner heading="No products are published" tone="warning">
          Active products must also be available on the Online Store sales
          channel to count as published.
        </s-banner>
      ) : null}

      <s-table>
        <s-table-header-row>
          <s-table-header format="base" listSlot="primary">
            <span className={styles.tableHeaderText}>Main Feed Statistics</span>
          </s-table-header>
          <s-table-header format="numeric" listSlot="labeled">
            <span className={styles.tableHeaderText}>Net Quantity</span>
          </s-table-header>
        </s-table-header-row>
        <s-table-body>
          {rows.map(({ key, label }) => {
            const value = statistics?.[key];

            return (
              <s-table-row key={key}>
                <s-table-cell>{label}</s-table-cell>
                <s-table-cell>
                  <span className={styles.numericValue}>
                    {state === "loading" ? (
                      <InlineLoadingValue label={`Loading ${label}`} />
                    ) : state === "error" || value === undefined ? (
                      <span className={styles.unavailableValue}>
                        Unavailable
                      </span>
                    ) : (
                      formatCount(value)
                    )}
                  </span>
                </s-table-cell>
              </s-table-row>
            );
          })}
        </s-table-body>
      </s-table>
    </s-stack>
  );
}

function StoreInformationCard({
  alertsEmail,
  alertsEmailState,
  store,
  state,
}: StoreInformationProps) {
  const hasMissingInformation =
    state === "ready" &&
    (!store?.domain ||
      !store.primaryMarket ||
      !store.currency ||
      !store.defaultLanguage);

  const renderValue = (
    value: string | null | undefined,
    label: string,
    skeletonWidth: "small" | "large",
    valueState = state,
  ) => {
    if (valueState === "loading") {
      return (
        <InlineLoadingValue
          label={`Loading store ${label}`}
          width={skeletonWidth}
        />
      );
    }

    if (valueState === "error") {
      return <span className={styles.unavailableValue}>Unavailable</span>;
    }

    return value || "Not available";
  };

  return (
    <s-stack gap="base">
      {hasMissingInformation ? (
        <s-banner heading="Store information is incomplete" tone="info">
          Some store details are not currently available from Shopify.
        </s-banner>
      ) : null}

      <dl className={styles.descriptionList}>
        <div className={styles.descriptionRow}>
          <dt>Domain</dt>
          <dd>{renderValue(store?.domain, "domain", "large")}</dd>
        </div>
        <div className={styles.descriptionRow}>
          <dt>Primary Market</dt>
          <dd>
            {state === "ready" && store?.primaryMarket ? (
              <span className={styles.badgeValue}>
                <s-badge>{store.primaryMarket}</s-badge>
              </span>
            ) : (
              renderValue(store?.primaryMarket, "primary market", "small")
            )}
          </dd>
        </div>
        <div className={styles.descriptionRow}>
          <dt>Currency</dt>
          <dd>
            {state === "ready" && store?.currency ? (
              <span className={styles.badgeValue}>
                <s-badge>{store.currency}</s-badge>
              </span>
            ) : (
              renderValue(store?.currency, "currency", "small")
            )}
          </dd>
        </div>
        <div className={styles.descriptionRow}>
          <dt>Default language</dt>
          <dd>
            {state === "ready" && store?.defaultLanguage ? (
              <span className={styles.badgeValue}>
                <s-badge>{store.defaultLanguage}</s-badge>
              </span>
            ) : (
              renderValue(store?.defaultLanguage, "default language", "small")
            )}
          </dd>
        </div>
        <div className={styles.descriptionRow}>
          <dt>Email</dt>
          <dd>
            {renderValue(alertsEmail, "email", "large", alertsEmailState)}
          </dd>
        </div>
      </dl>
    </s-stack>
  );
}

function FeedOverviewCard({ additional, primary, state }: FeedOverviewProps) {
  const primaryData = primary?.ok ? primary : null;
  const additionalData = additional?.ok ? additional : null;
  const rows = [
    ...(primaryData?.feed
      ? [
          {
            country:
              primaryData.market?.countryName ??
              primaryData.market?.countryCode ??
              "Not available",
            currency: primaryData.market?.currencyCode || "Not available",
            id: primaryData.feed.id,
            language:
              primaryData.market?.languageName ??
              primaryData.market?.locale.toUpperCase() ??
              "Not available",
            market: primaryData.market?.name ?? "Primary market",
            requiresRefresh: primaryData.feed.requiresRefresh,
            status: primaryData.feed.status,
            type: "Primary",
          },
        ]
      : []),
    ...(additionalData?.feeds.map(({ feed, market }) => ({
      country: market.countryName ?? market.countryCode ?? "Not available",
      currency: market.currencyCode || "Not available",
      id: feed.id,
      language: market.languageName ?? market.locale.toUpperCase(),
      market: market.name,
      requiresRefresh: feed.requiresRefresh,
      status: feed.status,
      type: "Additional",
    })) ?? []),
  ];

  return (
    <div className={styles.feedOverview}>
      <s-section>
        <div className={styles.feedOverviewHeader}>
          <div>
            <s-heading>Feeds</s-heading>
            <s-paragraph color="subdued">
              Generated and configured XML feeds for this store.
            </s-paragraph>
          </div>
          {state === "loading" ? (
            <InlineLoadingValue label="Loading feed count" />
          ) : (
            <s-badge tone={state === "error" ? "critical" : "info"}>
              {state === "error"
                ? "Unavailable"
                : `${rows.length} ${rows.length === 1 ? "feed" : "feeds"}`}
            </s-badge>
          )}
        </div>

        {state === "loading" ? (
          <div className={styles.feedOverviewLoading}>
            <span />
            <span />
            <span />
          </div>
        ) : state === "error" ? (
          <s-text color="subdued">
            Feed details are temporarily unavailable. Use Retry above to load
            them again.
          </s-text>
        ) : rows.length === 0 ? (
          <s-text color="subdued">
            This store does not have any configured XML feeds yet.
          </s-text>
        ) : (
          <div className={styles.feedOverviewTable}>
            <s-table>
              <s-table-header-row>
                <s-table-header format="base" listSlot="primary">Feed</s-table-header>
                <s-table-header format="base" listSlot="labeled">Market</s-table-header>
                <s-table-header format="base" listSlot="labeled">Country</s-table-header>
                <s-table-header format="base" listSlot="labeled">Language</s-table-header>
                <s-table-header format="base" listSlot="labeled">Currency</s-table-header>
                <s-table-header format="base" listSlot="labeled">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-badge tone={row.type === "Primary" ? "critical" : "info"}>
                        {row.type}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone="neutral">{row.market}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone="neutral">{row.country}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone="neutral">{row.language}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone="neutral">{row.currency}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <FeedStatusBadge
                        requiresRefresh={row.requiresRefresh}
                        status={row.status}
                      />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </div>
        )}
      </s-section>
    </div>
  );
}

function DashboardSectionResult({
  children,
  failed,
  onStateChange,
}: DashboardSectionResultProps) {
  useEffect(() => {
    onStateChange(failed);
  }, [failed, onStateChange]);

  return children;
}

function DashboardAsyncSection({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  // Query-cache notifications are synchronous external-store updates. Defer
  // the whole boundary element so they cannot replace its server markup while
  // the streamed loader promise is still hydrating on the client.
  return useDeferredValue(<Suspense fallback={fallback}>{children}</Suspense>);
}

function DashboardPanelContent({
  active,
  initialSubscription,
  diagnosticsScope,
  feedScope,
  statistics,
  storeInformation,
  isRefreshing,
  onOpenFeeds,
  onRefresh,
  planSelectionUrl,
}: DashboardPanelContentProps) {
  const [statisticsFailed, setStatisticsFailed] = useState(false);
  const [storeInformationFailed, setStoreInformationFailed] = useState(false);
  const configurationScope = diagnosticsScope ?? {
    shop: "pending-shop",
    sessionId: "pending-session",
  };
  const configurationQuery = useQuery({
    ...configurationQueryOptions(configurationScope),
    enabled:
      active &&
      Boolean(initialSubscription?.canUseApp) &&
      Boolean(diagnosticsScope),
  });
  const safeFeedScope = feedScope ?? {
    locale: null,
    sessionId: "pending-session",
    shop: "pending-shop",
  };
  const primaryFeedQuery = useQuery({
    ...primaryFeedQueryOptions(safeFeedScope),
    enabled:
      active && Boolean(initialSubscription?.canUseApp) && Boolean(feedScope),
  });
  const additionalFeedsQuery = useQuery({
    ...additionalFeedsQueryOptions(safeFeedScope),
    enabled:
      active && Boolean(initialSubscription?.canUseApp) && Boolean(feedScope),
  });
  const alertsEmailState: SectionState =
    !diagnosticsScope ||
    (configurationQuery.isPending && !configurationQuery.data)
      ? "loading"
      : configurationQuery.isError
        ? "error"
        : "ready";
  const refreshDashboard = () => {
    onRefresh();
    if (diagnosticsScope) {
      void configurationQuery.refetch();
    }
    if (feedScope) {
      void primaryFeedQuery.refetch();
      void additionalFeedsQuery.refetch();
    }
  };
  const tabAlerts: TabAlert[] = [];
  if (statisticsFailed) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: isRefreshing,
      heading: "Product statistics couldn't be loaded",
      id: "dashboard-statistics",
      message:
        "Shopify didn't return the catalog statistics. Try loading this section again.",
      onAction: refreshDashboard,
      tone: "critical",
    });
  }
  if (storeInformationFailed) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: isRefreshing,
      heading: "Store information couldn't be loaded",
      id: "dashboard-store-information",
      message:
        "Shopify didn't return this store's details. Try loading this section again.",
      onAction: refreshDashboard,
      tone: "critical",
    });
  }
  if (configurationQuery.isError) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: configurationQuery.isFetching,
      heading: "Store configuration couldn't be loaded",
      id: "dashboard-configuration",
      message: configurationQuery.error.message,
      onAction: refreshDashboard,
      tone: "critical",
    });
  }
  if (primaryFeedQuery.isError || additionalFeedsQuery.isError) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading:
        primaryFeedQuery.isFetching || additionalFeedsQuery.isFetching,
      heading: "Feed details couldn't be loaded",
      id: "dashboard-feed-details",
      message:
        primaryFeedQuery.error?.message ??
        additionalFeedsQuery.error?.message ??
        "Try loading the store feeds again.",
      onAction: () => {
        void primaryFeedQuery.refetch();
        void additionalFeedsQuery.refetch();
      },
      tone: "critical",
    });
  }
  const feedOverviewState: SectionState =
    !feedScope ||
    (primaryFeedQuery.isPending && !primaryFeedQuery.data) ||
    (additionalFeedsQuery.isPending && !additionalFeedsQuery.data)
      ? "loading"
      : primaryFeedQuery.isError || additionalFeedsQuery.isError
        ? "error"
        : "ready";

  return (
    <>
      <SubscriptionBanner
        initialSubscription={initialSubscription}
        shop={diagnosticsScope?.shop ?? null}
      />

      {initialSubscription && !initialSubscription.canUseApp ? (
        <InactivePlanBanner planSelectionUrl={planSelectionUrl} />
      ) : null}

      <div className={styles.dashboardHeader}>
        <div>
          <s-heading>Overview</s-heading>
          <s-paragraph color="subdued">
            Product publishing health and connected store details.
          </s-paragraph>
        </div>
        <div className={styles.refreshArea}>
          <span aria-live="polite" className={styles.visuallyHidden}>
            {isRefreshing ? "Refreshing dashboard data" : ""}
          </span>
          <s-button
            disabled={!initialSubscription?.canUseApp ? true : undefined}
            onClick={onOpenFeeds}
            variant="primary"
          >
            Open feeds
          </s-button>
          <s-button
            accessibilityLabel="Refresh dashboard data"
            disabled={!initialSubscription?.canUseApp ? true : undefined}
            icon="refresh"
            loading={isRefreshing ? true : undefined}
            onClick={refreshDashboard}
            variant="secondary"
          >
            Refresh
          </s-button>
        </div>
      </div>

      {initialSubscription && !initialSubscription.canUseApp ? null : (
        <>
          {tabAlerts.length > 0 ? (
            <div className={styles.dashboardAlert}>
              <TabAlertNavigator alerts={tabAlerts} />
            </div>
          ) : null}

          <div className={styles.cardGrid}>
            <s-section heading="Products">
              <s-stack gap="base">
                <DashboardAsyncSection
                  fallback={<StatisticsTable state="loading" />}
                >
                  <Await
                    errorElement={
                      <DashboardSectionResult
                        failed
                        onStateChange={setStatisticsFailed}
                      >
                        <StatisticsTable state="error" />
                      </DashboardSectionResult>
                    }
                    resolve={statistics}
                  >
                    {(loadedStatistics) => (
                      <DashboardSectionResult
                        failed={false}
                        onStateChange={setStatisticsFailed}
                      >
                        <StatisticsTable
                          state="ready"
                          statistics={loadedStatistics}
                        />
                      </DashboardSectionResult>
                    )}
                  </Await>
                </DashboardAsyncSection>
              </s-stack>
            </s-section>

            <s-section heading="Store">
              <DashboardAsyncSection
                fallback={
                  <StoreInformationCard
                    alertsEmail={
                      configurationQuery.data?.configuration.alertsEmail
                    }
                    alertsEmailState={alertsEmailState}
                    state="loading"
                  />
                }
              >
                <Await
                  errorElement={
                    <DashboardSectionResult
                      failed
                      onStateChange={setStoreInformationFailed}
                    >
                      <StoreInformationCard
                        alertsEmail={
                          configurationQuery.data?.configuration.alertsEmail
                        }
                        alertsEmailState={alertsEmailState}
                        state="error"
                      />
                    </DashboardSectionResult>
                  }
                  resolve={storeInformation}
                >
                  {(store) => (
                    <DashboardSectionResult
                      failed={false}
                      onStateChange={setStoreInformationFailed}
                    >
                      <StoreInformationCard
                        alertsEmail={
                          configurationQuery.data?.configuration.alertsEmail
                        }
                        alertsEmailState={alertsEmailState}
                        state="ready"
                        store={store}
                      />
                    </DashboardSectionResult>
                  )}
                </Await>
              </DashboardAsyncSection>
            </s-section>

            <FeedOverviewCard
              additional={additionalFeedsQuery.data}
              primary={primaryFeedQuery.data}
              state={feedOverviewState}
            />
          </div>
        </>
      )}
    </>
  );
}

export function DashboardTabs(props: DashboardTabsProps) {
  const shopify = useAppBridge();
  const location = useLocation();
  const navigate = useNavigate();
  const subscriptionQuery = useSubscription(
    props.diagnosticsScope?.shop ?? null,
    props.initialSubscription,
  );
  const subscription = subscriptionQuery.data ?? props.initialSubscription;
  const canUseApp = subscription?.canUseApp ?? true;
  const activeTab =
    dashboardTabFromLocation(location) ?? props.initialTab ?? "dashboard";
  const [hasUnsavedConfigurationChanges, setHasUnsavedConfigurationChanges] =
    useState(false);
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState<CSSProperties>({
    opacity: 0,
    transform: "translateX(0)",
    width: 0,
  });
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const updateTabIndicator = useCallback(() => {
    const activeIndex = tabs.findIndex(({ id }) => id === activeTab);
    const activeElement = tabRefs.current[activeIndex];

    if (!activeElement) {
      return;
    }

    const transform = `translateX(${activeElement.offsetLeft + 10}px)`;
    const width = Math.max(activeElement.offsetWidth - 20, 0);
    // Layout measurements can arrive before streamed dashboard data hydrates.
    // Let hydration finish before this cosmetic update re-renders its parent.
    startTransition(() => {
      setTabIndicatorStyle((current) =>
        current.opacity === 1 &&
        current.transform === transform &&
        current.width === width
          ? current
          : { opacity: 1, transform, width },
      );
    });
  }, [activeTab]);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(updateTabIndicator);
    const tabList = tabListRef.current;
    const resizeObserver = new ResizeObserver(updateTabIndicator);

    if (tabList) {
      resizeObserver.observe(tabList);
    }
    for (const tab of tabRefs.current) {
      if (tab) {
        resizeObserver.observe(tab);
      }
    }
    window.addEventListener("resize", updateTabIndicator);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateTabIndicator);
    };
  }, [updateTabIndicator]);

  useEffect(() => {
    const shop = props.diagnosticsScope?.shop;
    const requestedTab = dashboardTabFromLocation(location);
    if (requestedTab === null && !shop) {
      return;
    }
    const nextTab =
      requestedTab ?? parseDashboardTab(shop ? storedActiveTab(shop) : null);
    const destination = dashboardTabHref(
      nextTab,
      location.search,
      location.hash,
    );
    // Canonicalize old query links and restore the last tab using real routes.
    if (
      `${location.pathname}${location.search}${location.hash}` !== destination
    ) {
      void navigate(destination, { replace: true, preventScrollReset: true });
      return;
    }
    persistActiveTab(nextTab, shop);
  }, [location, navigate, props.diagnosticsScope?.shop]);

  const selectTab = async (tabId: DashboardTabId, tabIndex?: number) => {
    if (
      tabId !== activeTab &&
      activeTab === "configurations" &&
      hasUnsavedConfigurationChanges
    ) {
      try {
        await shopify.saveBar.leaveConfirmation();
      } catch {
        return;
      }
    }

    await navigate(dashboardTabHref(tabId, location.search, location.hash), {
      preventScrollReset: true,
    });
    if (tabIndex !== undefined) {
      tabRefs.current[tabIndex]?.focus();
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== undefined) {
      event.preventDefault();
      void selectTab(tabs[nextIndex].id, nextIndex);
    }
  };

  return (
    <div className={styles.appViewport}>
      <div className={styles.contentShell}>
        <div
          aria-label="Main sections"
          className={styles.tabList}
          ref={tabListRef}
          role="tablist"
        >
          {tabs.map((tab, index) => {
            const isActive = activeTab === tab.id;
            const TabIcon = tab.icon;

            return (
              <button
                aria-controls={`panel-${tab.id}`}
                aria-selected={isActive}
                className={styles.tab}
                id={`tab-${tab.id}`}
                key={tab.id}
                onClick={() => void selectTab(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                <TabIcon aria-hidden="true" className={styles.tabIcon} />
                <span>{tab.label}</span>
              </button>
            );
          })}
          <span
            aria-hidden="true"
            className={styles.tabIndicator}
            style={tabIndicatorStyle}
          />
        </div>

        <div
          aria-labelledby="tab-dashboard"
          className={styles.panel}
          hidden={activeTab !== "dashboard"}
          id="panel-dashboard"
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "dashboard" ? <PlanReviewBanner /> : null}
          <DashboardPanelContent
            {...props}
            active={activeTab === "dashboard"}
            initialSubscription={subscription}
            onOpenFeeds={() => void selectTab("feeds", 1)}
          />
        </div>

        <div
          aria-labelledby="tab-feeds"
          className={styles.panel}
          hidden={activeTab !== "feeds"}
          id="panel-feeds"
          role="tabpanel"
          tabIndex={0}
        >
          <BillingAccessGate
            canUseApp={canUseApp}
            planSelectionUrl={props.planSelectionUrl}
          >
            <FeedsPanel
              active={activeTab === "feeds" && canUseApp}
              scope={props.feedScope}
            />
          </BillingAccessGate>
        </div>

        <div
          aria-labelledby="tab-diagnostics"
          className={styles.panel}
          hidden={activeTab !== "diagnostics"}
          id="panel-diagnostics"
          role="tabpanel"
          tabIndex={0}
        >
          <BillingAccessGate
            canUseApp={canUseApp}
            planSelectionUrl={props.planSelectionUrl}
          >
            <DiagnosticsPanel
              active={activeTab === "diagnostics" && canUseApp}
              key={
                props.diagnosticsScope
                  ? `${props.diagnosticsScope.shop}:${props.diagnosticsScope.sessionId}`
                  : "diagnostics-pending"
              }
              scope={props.diagnosticsScope}
            />
          </BillingAccessGate>
        </div>

        <div
          aria-labelledby="tab-configurations"
          className={styles.panel}
          hidden={activeTab !== "configurations"}
          id="panel-configurations"
          role="tabpanel"
          tabIndex={0}
        >
          <BillingAccessGate
            canUseApp={canUseApp}
            planSelectionUrl={props.planSelectionUrl}
          >
            {activeTab === "configurations" ? (
              <ConfigurationsPanel
                active={canUseApp}
                onOpenFeeds={() => void selectTab("feeds", 1)}
                onUnsavedChangesChange={setHasUnsavedConfigurationChanges}
                scope={props.diagnosticsScope}
              />
            ) : null}
          </BillingAccessGate>
        </div>

        <div
          aria-labelledby="tab-support"
          className={styles.panel}
          hidden={activeTab !== "support"}
          id="panel-support"
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "support" ? (
            <>
              <PlanReviewBanner />
              <SupportPanel active scope={props.diagnosticsScope} />
            </>
          ) : null}
        </div>

        <div
          aria-labelledby="tab-plan"
          className={styles.panel}
          hidden={activeTab !== "plan"}
          id="panel-plan"
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "plan" ? (
            <>
              <PlanReviewBanner />
              <SubscriptionPanel
                initialSubscription={subscription}
                planSelectionUrl={props.planSelectionUrl}
                shop={props.diagnosticsScope?.shop ?? null}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
