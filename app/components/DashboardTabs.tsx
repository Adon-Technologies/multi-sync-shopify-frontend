import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Await } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useQuery } from "@tanstack/react-query";
import { HiHome } from "react-icons/hi2";
import { IoMdSettings } from "react-icons/io";
import { MdOutlineCreditCard } from "react-icons/md";
import { SiGoogleanalytics } from "react-icons/si";
import { TbFileTypeXml } from "react-icons/tb";

import { InlineLoadingValue } from "./DashboardStates";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ConfigurationsPanel } from "./ConfigurationsPanel";
import { FeedsPanel } from "./FeedsPanel";
import {
  TabAlertNavigator,
  type TabAlert,
} from "./TabAlertNavigator";
import type {
  ProductStatistics,
  StoreInformation,
} from "../services/dashboard.server";
import { configurationQueryOptions } from "../services/configuration-query";
import type { DiagnosticsQueryScope } from "../services/diagnostics-query";
import type { FeedQueryScope } from "../services/feed-query";
import styles from "../styles/dashboard.module.css";

const tabs = [
  { icon: HiHome, id: "dashboard", label: "Dashboard" },
  { icon: TbFileTypeXml, id: "feeds", label: "Feeds" },
  { icon: SiGoogleanalytics, id: "diagnostics", label: "Diagnostics" },
  { icon: IoMdSettings, id: "configurations", label: "Configurations" },
  { icon: MdOutlineCreditCard, id: "plan", label: "Plan" },
] as const;

export type DashboardTabId = (typeof tabs)[number]["id"];
type SectionState = "loading" | "ready" | "error";
type StatisticKey = Exclude<keyof ProductStatistics, "generatedAt">;

interface DashboardTabsProps {
  diagnosticsScope: DiagnosticsQueryScope | null;
  feedScope: FeedQueryScope | null;
  initialTab?: DashboardTabId;
  statistics: Promise<ProductStatistics>;
  storeInformation: Promise<StoreInformation>;
  isRefreshing: boolean;
  onRefresh: () => void;
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

interface DashboardSectionResultProps {
  children: ReactNode;
  failed: boolean;
  onStateChange: (failed: boolean) => void;
}

export function parseDashboardTab(value: string | null): DashboardTabId {
  return tabs.some(({ id }) => id === value)
    ? (value as DashboardTabId)
    : "dashboard";
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

  const url = new URL(window.location.href);
  if (tabId === "dashboard") {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tabId);
  }
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
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

function StatisticsTable({
  statistics,
  state,
}: StatisticsTableProps) {
  const rows: Array<{ key: StatisticKey; label: string }> = [
    { key: "totalProducts", label: "Total products" },
    { key: "publishedProducts", label: "Published products" },
    {
      key: "publishedProductVariants",
      label: "Published product variants",
    },
    { key: "unpublishedProducts", label: "Unpublished products" },
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
    state === "ready" && (!store?.domain || !store.currency);

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
          <dt>Email</dt>
          <dd>
            {renderValue(alertsEmail, "email", "large", alertsEmailState)}
          </dd>
        </div>
      </dl>
    </s-stack>
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

function DashboardPanelContent({
  active,
  diagnosticsScope,
  statistics,
  storeInformation,
  isRefreshing,
  onOpenFeeds,
  onRefresh,
}: DashboardPanelContentProps) {
  const [statisticsFailed, setStatisticsFailed] = useState(false);
  const [storeInformationFailed, setStoreInformationFailed] = useState(false);
  const configurationScope = diagnosticsScope ?? {
    shop: "pending-shop",
    sessionId: "pending-session",
  };
  const configurationQuery = useQuery({
    ...configurationQueryOptions(configurationScope),
    enabled: active && Boolean(diagnosticsScope),
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

  return (
    <>
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
          <s-button onClick={onOpenFeeds} variant="primary">
            Open feeds
          </s-button>
          <s-button
            accessibilityLabel="Refresh dashboard data"
            icon="refresh"
            loading={isRefreshing ? true : undefined}
            onClick={refreshDashboard}
            variant="secondary"
          >
            Refresh
          </s-button>
        </div>
      </div>

      {tabAlerts.length > 0 ? (
        <div className={styles.dashboardAlert}>
          <TabAlertNavigator alerts={tabAlerts} />
        </div>
      ) : null}

      <div className={styles.cardGrid}>
        <s-section heading="Products">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Variants usually become individual Google feed items.
            </s-paragraph>
            <Suspense
              fallback={
                <StatisticsTable
                  state="loading"
                />
              }
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
            </Suspense>
          </s-stack>
        </s-section>

        <s-section heading="Store">
          <Suspense
            fallback={
              <StoreInformationCard
                alertsEmail={configurationQuery.data?.configuration.alertsEmail}
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
          </Suspense>
        </s-section>
      </div>
    </>
  );
}

export function DashboardTabs(props: DashboardTabsProps) {
  const shopify = useAppBridge();
  const [activeTab, setActiveTab] = useState<DashboardTabId>(
    props.initialTab ?? "dashboard",
  );
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

    setTabIndicatorStyle({
      opacity: 1,
      transform: `translateX(${activeElement.offsetLeft + 10}px)`,
      width: Math.max(activeElement.offsetWidth - 20, 0),
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
    if (
      !shop ||
      new URL(window.location.href).searchParams.has("tab")
    ) {
      return;
    }

    const storedTab = parseDashboardTab(
      storedActiveTab(shop),
    );
    setActiveTab(storedTab);
  }, [props.diagnosticsScope?.shop]);

  const selectTab = async (
    tabId: DashboardTabId,
    tabIndex?: number,
  ) => {
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

    setActiveTab(tabId);
    persistActiveTab(tabId, props.diagnosticsScope?.shop);
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
          <DashboardPanelContent
            {...props}
            active={activeTab === "dashboard"}
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
          <FeedsPanel active={activeTab === "feeds"} scope={props.feedScope} />
        </div>

        <div
          aria-labelledby="tab-diagnostics"
          className={styles.panel}
          hidden={activeTab !== "diagnostics"}
          id="panel-diagnostics"
          role="tabpanel"
          tabIndex={0}
        >
          <DiagnosticsPanel
            active={activeTab === "diagnostics"}
            key={
              props.diagnosticsScope
                ? `${props.diagnosticsScope.shop}:${props.diagnosticsScope.sessionId}`
                : "diagnostics-pending"
            }
            scope={props.diagnosticsScope}
          />
        </div>

        <div
          aria-labelledby="tab-configurations"
          className={styles.panel}
          hidden={activeTab !== "configurations"}
          id="panel-configurations"
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "configurations" ? (
            <ConfigurationsPanel
              active
              onUnsavedChangesChange={setHasUnsavedConfigurationChanges}
              scope={props.diagnosticsScope}
            />
          ) : null}
        </div>

        <div
          aria-labelledby="tab-plan"
          className={`${styles.panel} ${styles.emptyPlan}`}
          hidden={activeTab !== "plan"}
          id="panel-plan"
          role="tabpanel"
          tabIndex={0}
        />
      </div>
    </div>
  );
}
