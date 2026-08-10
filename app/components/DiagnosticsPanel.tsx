import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CiWarning } from "react-icons/ci";
import { IoCheckmarkDoneOutline } from "react-icons/io5";
import { VscCircleSlash, VscError } from "react-icons/vsc";

import type {
  DiagnosticsCounts,
  DiagnosticsPage,
  DiagnosticsPageInfo,
  DiagnosticsTab,
} from "../services/diagnostics.server";
import {
  createDiagnosticsClientState,
  diagnosticsFilterOptionsQueryOptions,
  diagnosticsKeys,
  diagnosticsProductsQueryOptions,
  diagnosticsSummaryQueryOptions,
  getDiagnosticsClientState,
  type DiagnosticsClientState,
  type DiagnosticsPageNavigation,
  type DiagnosticsQueryScope,
} from "../services/diagnostics-query";
import {
  diagnosticsFilterFields,
  diagnosticsFilterLabels,
  type DiagnosticsFilter,
  type DiagnosticsFilterField,
} from "../services/diagnostics-filter";
import { normalizeDiagnosticsSearch } from "../services/diagnostics-search";
import {
  DEFAULT_DIAGNOSTICS_SORT,
  normalizeDiagnosticsSort,
  type DiagnosticsSort,
} from "../services/diagnostics-sort";
import type { DiagnosticProduct } from "../services/diagnostics-validation";
import styles from "../styles/diagnostics.module.css";
import {
  TabAlertNavigator,
  type TabAlert,
} from "./TabAlertNavigator";

const diagnosticTabs: Array<{
  id: DiagnosticsTab;
  label: string;
  countKey: keyof Pick<
    DiagnosticsCounts,
    "allProducts" | "submitted" | "warnings" | "excluded"
  >;
}> = [
  { id: "all", label: "All Products", countKey: "allProducts" },
  { id: "submitted", label: "Submitted", countKey: "submitted" },
  {
    id: "warnings",
    label: "Submitted with Warnings",
    countKey: "warnings",
  },
  { id: "excluded", label: "Excluded", countKey: "excluded" },
];

const badgeToneClass: Record<DiagnosticsTab, string> = {
  all: styles.badgeAll,
  submitted: styles.badgeSubmitted,
  warnings: styles.badgeWarning,
  excluded: styles.badgeExcluded,
};

const FILTER_POPOVER_ID = "diagnostics-product-filter-popover";
const FILTER_FIELD_POPOVER_ID = "diagnostics-filter-field-popover";
const FILTER_VALUE_POPOVER_ID = "diagnostics-filter-value-popover";
const SORT_POPOVER_ID = "diagnostics-sort-popover";

const diagnosticsFilterFieldOptions = diagnosticsFilterFields.map((field) => ({
  label: diagnosticsFilterLabels[field],
  value: field,
}));

const diagnosticsSortOptions: Array<{
  label: string;
  value: DiagnosticsSort;
}> = [
  { label: "Created - Newest First", value: "created-desc" },
  { label: "Created - Oldest First", value: "created-asc" },
  { label: "Product Title - A to Z", value: "title-asc" },
  { label: "Product Title - Z to A", value: "title-desc" },
  { label: "Product type - A to Z", value: "product-type-asc" },
  { label: "Product type - Z to A", value: "product-type-desc" },
];

interface DiagnosticsPanelProps {
  active: boolean;
  dataEndpoint?: string;
  scope: DiagnosticsQueryScope | null;
}

interface DiagnosticsRefreshFallback {
  counts?: DiagnosticsCounts;
  page?: {
    tab: DiagnosticsTab;
    value: DiagnosticsPage;
  };
}

interface DiagnosticsTableProps {
  canGoPrevious: boolean;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  pageIndex: number;
  pageInfo?: DiagnosticsPageInfo;
  products: DiagnosticProduct[];
  searchTerm: string;
  totalProducts?: number;
  onNext: () => void;
  onPrevious: () => void;
  onRefresh: () => void;
}

function PolarisOptionPicker({
  accessibilityLabel,
  disabled = false,
  id,
  onChange,
  options,
  placeholder,
  showSortIcon = false,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  id: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  placeholder: string;
  showSortIcon?: boolean;
  value: string;
}) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? placeholder;

  return (
    <div className={styles.polarisPicker}>
      <s-clickable
        accessibilityLabel={accessibilityLabel}
        background="base"
        blockSize="32px"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={id}
        disabled={disabled}
        inlineSize="100%"
        padding="none"
      >
        <span className={styles.pickerTriggerContent}>
          <span className={styles.pickerTriggerLabel}>
            {showSortIcon ? <s-icon type="sort" /> : null}
            <s-text color={value ? "base" : "subdued"}>
              {selectedLabel}
            </s-text>
          </span>
          <s-icon color="subdued" type="chevron-down" />
        </span>
      </s-clickable>
      <s-popover id={id}>
        <s-box padding="small-200">
          <div className={styles.polarisPickerOptions}>
            {options.map((option) => (
              <s-button
                command="--hide"
                commandFor={id}
                key={option.value}
                onClick={() => onChange(option.value)}
                variant="tertiary"
              >
                <span className={styles.polarisPickerOption}>
                  <span>{option.label}</span>
                  {option.value === value ? <s-icon type="check" /> : null}
                </span>
              </s-button>
            ))}
          </div>
        </s-box>
      </s-popover>
    </div>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function BadgeValue({
  isLoading,
  isRefreshing,
  toneClass,
  value,
}: {
  isLoading: boolean;
  isRefreshing: boolean;
  toneClass: string;
  value?: number;
}) {
  if (isLoading) {
    return (
      <span
        aria-label="Loading count"
        className={styles.badgeSkeleton}
        role="status"
      />
    );
  }

  return (
    <span className={`${styles.badgeValue} ${toneClass}`}>
      <span>{value === undefined ? "—" : formatCount(value)}</span>
      {isRefreshing ? (
        <span
          aria-label="Refreshing count"
          className={styles.badgeRefreshSpinner}
          role="status"
        />
      ) : null}
    </span>
  );
}

function getShopifyProductAdminUrl(productId: string) {
  const numericId = productId.split("/").at(-1);
  return `shopify://admin/products/${encodeURIComponent(numericId || productId)}`;
}

function ProductImage({ product }: { product: DiagnosticProduct }) {
  if (!product.imageUrl) {
    return (
      <span
        aria-label="No product image"
        className={styles.imageFallback}
        role="img"
      >
        <span />
      </span>
    );
  }

  return (
    <img
      alt={product.imageAlt || ""}
      className={styles.productImage}
      loading="lazy"
      src={product.imageUrl}
    />
  );
}

function StatusIcon({ status }: { status: DiagnosticProduct["status"] }) {
  if (status === "submitted") {
    return (
      <IoCheckmarkDoneOutline
        aria-label="Submitted with no warnings"
        className={styles.statusSubmitted}
        role="img"
        title="Submitted with no warnings or errors"
      />
    );
  }

  if (status === "warning") {
    return (
      <CiWarning
        aria-label="Submitted with warnings"
        className={styles.statusWarning}
        role="img"
        title="Submitted with warnings"
      />
    );
  }

  return (
    <VscError
      aria-label="Excluded because of errors"
      className={styles.statusError}
      role="img"
      title="Excluded because of errors"
    />
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <tr aria-hidden="true" key={index}>
          <td>
            <div className={styles.skeletonProduct}>
              <span className={styles.skeletonImage} />
              <span className={styles.skeletonTitle} />
            </div>
          </td>
          <td>
            <span className={styles.skeletonCategory} />
          </td>
          <td className={styles.statusCell}>
            <span className={styles.skeletonStatus} />
          </td>
          <td>
            <span className={styles.skeletonWarning} />
            <span className={styles.skeletonWarningShort} />
          </td>
        </tr>
      ))}
    </>
  );
}

function DiagnosticsTable({
  canGoPrevious,
  error,
  isLoading,
  isRefreshing,
  pageIndex,
  pageInfo,
  products,
  searchTerm,
  totalProducts,
  onNext,
  onPrevious,
  onRefresh,
}: DiagnosticsTableProps) {
  const emptyMessage = normalizeDiagnosticsSearch(searchTerm)
    ? "No products match your search."
    : "No products are available in this view.";
  const firstProduct = products.length === 0 ? 0 : pageIndex * 25 + 1;
  const lastProduct =
    products.length === 0 ? 0 : firstProduct + products.length - 1;

  return (
    <>
      <div className={styles.tableSummary}>
        <span aria-live="polite">
          {isLoading
            ? "Loading products"
            : `Showing ${formatCount(firstProduct)} to ${formatCount(
                lastProduct,
              )} of ${formatCount(
                totalProducts ?? products.length,
              )} Products`}
        </span>
      </div>

      <div className={styles.tableViewport}>
        <table className={styles.diagnosticsTable}>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">
                <span className={styles.categoryColumnAnchor}>
                  Google product category
                </span>
              </th>
              <th className={styles.googleHeader} scope="col">
                <img alt="Google" src="/google-icon-1.png" />
              </th>
              <th scope="col">
                <div className={styles.errorHeader}>
                  <span>Error from merchant center</span>
                  <s-button
                    accessibilityLabel="Refresh product errors"
                    disabled={isRefreshing}
                    icon="refresh"
                    loading={isRefreshing ? true : undefined}
                    onClick={onRefresh}
                    tone="critical"
                    variant="tertiary"
                  >
                    Refresh product Errors
                  </s-button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : error && products.length === 0 ? (
              <tr>
                <td className={styles.emptyCell} colSpan={4}>
                  {error}
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td className={styles.emptyCell} colSpan={4}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className={styles.productCell}>
                      <ProductImage product={product} />
                      <a
                        className={styles.productTitle}
                        href={getShopifyProductAdminUrl(product.id)}
                        rel="noopener noreferrer"
                        target="_blank"
                        title="Open product in Shopify Admin"
                      >
                        {product.title || "Untitled product"}
                      </a>
                    </div>
                  </td>
                  <td className={styles.categoryCell}>
                    <span className={styles.categoryColumnAnchor}>
                      {product.categoryName ? (
                        <span className={styles.productCategory}>
                          {product.categoryName}
                        </span>
                      ) : (
                        <VscCircleSlash
                          aria-label="No Google product category"
                          className={styles.emptyCategory}
                          role="img"
                          title="No Google product category"
                        />
                      )}
                    </span>
                  </td>
                  <td className={styles.statusCell}>
                    <StatusIcon status={product.status} />
                  </td>
                  <td>
                    {product.warnings.length === 0 ? (
                      <span className={styles.noWarnings}>
                        No warnings found
                      </span>
                    ) : (
                      <ul className={styles.warningList}>
                        {product.warnings.map((warning) => (
                          <li key={warning.code}>{warning.message}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <div
          aria-label="Diagnostics pagination"
          className={styles.paginationButtons}
          role="group"
        >
          <s-button
            accessibilityLabel="Load previous diagnostics page"
            disabled={isLoading || Boolean(error) || !canGoPrevious}
            icon="chevron-left"
            onClick={onPrevious}
            variant="secondary"
          >
            Previous
          </s-button>
          <s-button
            accessibilityLabel="Load next diagnostics page"
            disabled={isLoading || Boolean(error) || !pageInfo?.hasNextPage}
            icon="chevron-right"
            onClick={onNext}
            variant="secondary"
          >
            Next
          </s-button>
        </div>
      </div>
    </>
  );
}

export function DiagnosticsPanel({
  active,
  dataEndpoint = "/app/diagnostics-data",
  scope,
}: DiagnosticsPanelProps) {
  const queryClient = useQueryClient();
  const queryScope = scope ?? {
    shop: "pending-shop",
    sessionId: "pending-session",
  };
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedTab, setSelectedTab] = useState<DiagnosticsTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<DiagnosticsFilter | null>(
    null,
  );
  const [draftFilterField, setDraftFilterField] =
    useState<DiagnosticsFilterField | null>(null);
  const [draftFilterValue, setDraftFilterValue] = useState("");
  const [selectedSort, setSelectedSort] = useState<DiagnosticsSort | "">("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshFallback, setRefreshFallback] =
    useState<DiagnosticsRefreshFallback | null>(null);
  const [clientState, setClientState] = useState<DiagnosticsClientState>(() =>
    scope
      ? getDiagnosticsClientState(queryClient, scope)
      : createDiagnosticsClientState(),
  );
  const normalizedSearch = normalizeDiagnosticsSearch(debouncedSearch);
  const activeSort = selectedSort || DEFAULT_DIAGNOSTICS_SORT;
  const tabNavigation = clientState.tabs[selectedTab];
  const navigation: DiagnosticsPageNavigation = normalizedSearch
    ? (tabNavigation.searches[normalizedSearch] ?? {
        history: [{ after: null }],
        index: 0,
      })
    : tabNavigation;
  const pageRequest = navigation.history[navigation.index];
  const queriesEnabled = Boolean(scope) && active;
  const fallbackPage =
    refreshFallback?.page?.tab === selectedTab
      ? refreshFallback.page.value
      : undefined;
  const summaryQuery = useQuery({
    ...diagnosticsSummaryQueryOptions(queryScope, clientState.generation, {
      endpoint: dataEndpoint,
      force: isRefreshing,
    }),
    enabled: queriesEnabled,
    placeholderData: refreshFallback?.counts,
  });
  const pageQueryOptions = diagnosticsProductsQueryOptions(
    queryScope,
    clientState.generation,
    selectedTab,
    pageRequest,
    {
      endpoint: dataEndpoint,
      filter: activeFilter,
      force: isRefreshing,
      search: normalizedSearch,
      sort: activeSort,
    },
  );
  const pageQuery = useQuery({
    ...pageQueryOptions,
    enabled: queriesEnabled && !isRefreshing,
    placeholderData: fallbackPage,
  });
  // Badge totals always come from the independent store-wide summary query.
  // Paginated page data is used only by the table below.
  const storeWideCounts = summaryQuery.data ?? refreshFallback?.counts;
  const page = pageQuery.data ?? fallbackPage;
  const countsError = summaryQuery.isError ? summaryQuery.error.message : null;
  const pageError = pageQuery.isError ? pageQuery.error.message : null;
  const countsLoading = summaryQuery.isPending && !storeWideCounts;
  const countsRefreshing = isRefreshing && summaryQuery.isFetching;
  const pageLoading = pageQuery.isPending && !page;
  const selectedTabDefinition = diagnosticTabs.find(
    ({ id }) => id === selectedTab,
  );
  const selectedTabTotal =
    storeWideCounts?.hasSnapshot && selectedTabDefinition
      ? storeWideCounts[selectedTabDefinition.countKey]
      : undefined;
  const filterSnapshotVersion =
    page?.scanVersion ?? storeWideCounts?.scanVersion ?? null;
  const filterOptionsQuery = useQuery({
    ...diagnosticsFilterOptionsQueryOptions(
      queryScope,
      clientState.generation,
      selectedTab,
      draftFilterField ?? "gender",
      filterSnapshotVersion,
      { endpoint: dataEndpoint },
    ),
    enabled:
      queriesEnabled &&
      Boolean(draftFilterField) &&
      Boolean(filterSnapshotVersion),
  });
  const filterOptions = filterOptionsQuery.data?.options ?? [];

  useEffect(() => {
    const nextSearch = normalizeDiagnosticsSearch(searchTerm);

    if (!nextSearch) {
      setDebouncedSearch("");
      return;
    }

    const debounceTimer = window.setTimeout(() => {
      setDebouncedSearch(nextSearch);
    }, 350);

    return () => window.clearTimeout(debounceTimer);
  }, [searchTerm]);

  useEffect(() => {
    const loadedPage = pageQuery.data;

    if (
      !active ||
      !scope ||
      isRefreshing ||
      pageQuery.isFetching ||
      pageQuery.isPlaceholderData ||
      pageQuery.isError ||
      !loadedPage?.pageInfo.hasNextPage ||
      !loadedPage.pageInfo.endCursor
    ) {
      return;
    }

    const nextRequest = {
      after: loadedPage.pageInfo.endCursor,
      snapshotVersion: loadedPage.scanVersion,
    };
    const nextOptions = diagnosticsProductsQueryOptions(
      scope,
      clientState.generation,
      selectedTab,
      nextRequest,
      {
        abortOnUnmount: true,
        endpoint: dataEndpoint,
        filter: activeFilter,
        search: normalizedSearch,
        sort: activeSort,
      },
    );
    const nextState = queryClient.getQueryState(nextOptions.queryKey);

    if (
      nextState?.status === "success" ||
      nextState?.fetchStatus === "fetching"
    ) {
      return;
    }

    void queryClient.prefetchQuery(nextOptions);

    return () => {
      const prefetchedQuery = queryClient
        .getQueryCache()
        .find({ queryKey: nextOptions.queryKey });

      if (prefetchedQuery?.getObserversCount() === 0) {
        void queryClient.cancelQueries({
          exact: true,
          queryKey: nextOptions.queryKey,
        });
      }
    };
  }, [
    active,
    activeFilter,
    activeSort,
    clientState.generation,
    dataEndpoint,
    isRefreshing,
    normalizedSearch,
    pageQuery.data,
    pageQuery.isError,
    pageQuery.isFetching,
    pageQuery.isPlaceholderData,
    queryClient,
    scope,
    selectedTab,
  ]);

  const storeClientState = (nextState: DiagnosticsClientState) => {
    setClientState(nextState);
    if (scope) {
      queryClient.setQueryData(diagnosticsKeys.clientState(scope), nextState);
    }
  };

  const selectTab = (tab: DiagnosticsTab, index?: number) => {
    setSelectedTab(tab);
    setSearchTerm("");
    setDebouncedSearch("");

    if (index !== undefined) {
      tabRefs.current[index]?.focus();
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % diagnosticTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + diagnosticTabs.length) % diagnosticTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = diagnosticTabs.length - 1;
    }

    if (nextIndex !== undefined) {
      event.preventDefault();
      selectTab(diagnosticTabs[nextIndex].id, nextIndex);
    }
  };

  const refresh = async () => {
    if (!scope || isRefreshing) {
      return;
    }

    const nextState = createDiagnosticsClientState(
      Math.max(Date.now(), clientState.generation + 1),
    );
    const previousClientState = clientState;
    const previousFallback: DiagnosticsRefreshFallback = {
      counts: storeWideCounts,
      ...(page
        ? {
            page: {
              tab: selectedTab,
              value: page,
            },
          }
        : {}),
    };

    queryClient.setQueryData(diagnosticsKeys.clientState(scope), nextState);
    flushSync(() => {
      setRefreshError(null);
      setRefreshFallback(previousFallback);
      setIsRefreshing(true);
      setClientState(nextState);
      setSearchTerm("");
      setDebouncedSearch("");
    });

    try {
      const refreshedCounts = await queryClient.fetchQuery(
        diagnosticsSummaryQueryOptions(scope, nextState.generation, {
          endpoint: dataEndpoint,
          force: true,
        }),
      );

      if (!refreshedCounts.hasSnapshot || !refreshedCounts.scanVersion) {
        throw new Error("The refreshed Diagnostics snapshot is unavailable.");
      }

      const refreshedPageRequest = {
        after: null,
        snapshotVersion: refreshedCounts.scanVersion,
      };
      await queryClient.fetchQuery(
        diagnosticsProductsQueryOptions(
          scope,
          nextState.generation,
          selectedTab,
          refreshedPageRequest,
          {
            endpoint: dataEndpoint,
            filter: activeFilter,
            sort: activeSort,
          },
        ),
      );
      const completedState: DiagnosticsClientState = {
        ...nextState,
        tabs: {
          ...nextState.tabs,
          [selectedTab]: {
            ...nextState.tabs[selectedTab],
            history: [refreshedPageRequest],
          },
        },
      };

      queryClient.setQueryData(
        diagnosticsKeys.clientState(scope),
        completedState,
      );
      setClientState(completedState);
      queryClient.removeQueries({
        queryKey: diagnosticsKeys.shop(scope.shop),
        predicate: (query) =>
          query.queryKey[2] === scope.sessionId &&
          query.queryKey[3] !== nextState.generation,
      });
      setRefreshFallback(null);
    } catch {
      queryClient.setQueryData(
        diagnosticsKeys.clientState(scope),
        previousClientState,
      );
      setClientState(previousClientState);
      setRefreshFallback(null);
      setRefreshError(
        "Diagnostics couldn't be refreshed. The previous results are still available.",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadPrevious = () => {
    if (navigation.index > 0) {
      const nextNavigation = {
        ...navigation,
        index: navigation.index - 1,
      };

      storeClientState({
        ...clientState,
        tabs: {
          ...clientState.tabs,
          [selectedTab]: normalizedSearch
            ? {
                ...tabNavigation,
                searches: {
                  ...tabNavigation.searches,
                  [normalizedSearch]: nextNavigation,
                },
              }
            : {
                ...tabNavigation,
                ...nextNavigation,
              },
        },
      });
    }
  };

  const loadNext = () => {
    if (!page?.pageInfo.endCursor || !page.pageInfo.hasNextPage) {
      return;
    }

    const nextRequest = {
      after: page.pageInfo.endCursor,
      snapshotVersion: page.scanVersion,
    };
    const cachedNextRequest = navigation.history[navigation.index + 1];
    const history =
      cachedNextRequest?.after === nextRequest.after &&
      cachedNextRequest.snapshotVersion === nextRequest.snapshotVersion
        ? navigation.history
        : [...navigation.history.slice(0, navigation.index + 1), nextRequest];
    const nextNavigation = {
      history,
      index: navigation.index + 1,
    };

    storeClientState({
      ...clientState,
      tabs: {
        ...clientState.tabs,
        [selectedTab]: normalizedSearch
          ? {
              ...tabNavigation,
              searches: {
                ...tabNavigation.searches,
                [normalizedSearch]: nextNavigation,
              },
            }
          : {
              ...tabNavigation,
              ...nextNavigation,
            },
      },
    });
  };

  const changeSort = (value: string) => {
    const nextSort = normalizeDiagnosticsSort(value);
    setSelectedSort(nextSort);

    if (nextSort !== activeSort) {
      storeClientState(createDiagnosticsClientState(clientState.generation));
    }
  };

  const resetDraftFilter = () => {
    setDraftFilterField(activeFilter?.field ?? null);
    setDraftFilterValue(activeFilter?.value ?? "");
  };

  const changeDraftFilterField = (value: string) => {
    setDraftFilterField(value as DiagnosticsFilterField);
    setDraftFilterValue("");
  };

  const applyFilter = () => {
    if (!draftFilterField || !draftFilterValue) {
      return;
    }

    const nextFilter = {
      field: draftFilterField,
      value: draftFilterValue,
    };
    setActiveFilter(nextFilter);
    storeClientState(createDiagnosticsClientState(clientState.generation));
  };

  const clearFilter = () => {
    setActiveFilter(null);
    setDraftFilterField(null);
    setDraftFilterValue("");
    storeClientState(createDiagnosticsClientState(clientState.generation));
  };

  const tabAlerts: TabAlert[] = [];
  if (countsError) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: isRefreshing,
      heading: "Diagnostic totals are unavailable",
      id: "diagnostic-totals",
      message: `${countsError} Previous totals are still shown when available. Select Refresh to try again.`,
      onAction: refresh,
      tone: "warning",
    });
  }
  if (refreshError) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: isRefreshing,
      heading: "Diagnostics refresh failed",
      id: "diagnostics-refresh",
      message: refreshError,
      onAction: refresh,
      tone: "warning",
    });
  }
  if (pageError) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: isRefreshing,
      heading: "Products are unavailable",
      id: "diagnostic-products",
      message: `${pageError} Previous products are still shown when available. Select Refresh to try again.`,
      onAction: refresh,
      tone: "warning",
    });
  }

  return (
    <div className={styles.diagnostics}>
      <div className={styles.header}>
        <div>
          <s-heading>Diagnostics</s-heading>
          <s-paragraph color="subdued">
            Review products before they are submitted to Google.
          </s-paragraph>
        </div>
      </div>

      {tabAlerts.length > 0 ? (
        <div className={styles.errorBanner}>
          <TabAlertNavigator alerts={tabAlerts} />
        </div>
      ) : null}

      <div className={styles.card}>
        <div
          aria-label="Diagnostic product status"
          className={styles.innerTabs}
          role="tablist"
        >
          <img
            alt="Google"
            className={styles.diagnosticsLogo}
            src="/google-icon-1.png"
          />
          {diagnosticTabs.map((tab, index) => {
            const selected = tab.id === selectedTab;

            return (
              <button
                aria-controls={`diagnostics-panel-${tab.id}`}
                aria-selected={selected}
                className={styles.innerTab}
                id={`diagnostics-tab-${tab.id}`}
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span>{tab.label}</span>
                <BadgeValue
                  isLoading={countsLoading}
                  isRefreshing={countsRefreshing}
                  toneClass={badgeToneClass[tab.id]}
                  value={
                    storeWideCounts?.hasSnapshot
                      ? storeWideCounts[tab.countKey]
                      : undefined
                  }
                />
              </button>
            );
          })}
        </div>

        <div
          aria-labelledby={`diagnostics-tab-${selectedTab}`}
          className={styles.innerPanel}
          id={`diagnostics-panel-${selectedTab}`}
          role="tabpanel"
          tabIndex={0}
        >
          <div className={styles.searchToolbar}>
            <div className={styles.filterSelect}>
              <s-clickable
                accessibilityLabel="Filter products"
                background="base"
                blockSize="32px"
                border="small-100"
                borderColor="base"
                borderRadius="base"
                borderStyle="solid"
                command="--show"
                commandFor={FILTER_POPOVER_ID}
                inlineSize="100%"
                onClick={resetDraftFilter}
                padding="none"
              >
                <span className={styles.pickerTriggerContent}>
                  <span className={styles.pickerTriggerLabel}>
                    <s-text>
                      Filter Products{activeFilter ? " (1)" : ""}
                    </s-text>
                  </span>
                  <s-icon color="subdued" type="chevron-down" />
                </span>
              </s-clickable>
              <s-popover id={FILTER_POPOVER_ID} inlineSize="360px">
                <s-box padding="base">
                  <div className={styles.filterPopoverContent}>
                    <div className={styles.filterPopoverHeader}>
                      <s-heading>Show all products where:</s-heading>
                      <s-button
                        accessibilityLabel="Close product filters"
                        command="--hide"
                        commandFor={FILTER_POPOVER_ID}
                        icon="x"
                        onClick={resetDraftFilter}
                        variant="tertiary"
                      />
                    </div>

                    <PolarisOptionPicker
                      accessibilityLabel="Select a product filter"
                      id={FILTER_FIELD_POPOVER_ID}
                      onChange={changeDraftFilterField}
                      options={diagnosticsFilterFieldOptions}
                      placeholder="Select Filter..."
                      value={draftFilterField ?? ""}
                    />

                    {draftFilterField ? (
                      <div className={styles.filterCondition}>
                        <s-text>is</s-text>
                        <PolarisOptionPicker
                          accessibilityLabel={`Select ${diagnosticsFilterLabels[draftFilterField]}`}
                          disabled={
                            filterOptionsQuery.isPending ||
                            filterOptionsQuery.isError ||
                            filterOptions.length === 0
                          }
                          id={FILTER_VALUE_POPOVER_ID}
                          onChange={setDraftFilterValue}
                          options={filterOptions}
                          placeholder={
                            filterOptionsQuery.isPending
                              ? "Loading values..."
                              : `Select ${diagnosticsFilterLabels[draftFilterField]}...`
                          }
                          value={draftFilterValue}
                        />
                        {filterOptionsQuery.isError ? (
                          <s-text tone="critical">
                            Filter values couldn&apos;t be loaded.
                          </s-text>
                        ) : !filterOptionsQuery.isPending &&
                          filterOptions.length === 0 ? (
                          <s-text color="subdued">
                            No values are available for this filter.
                          </s-text>
                        ) : null}
                      </div>
                    ) : null}

                    <div className={styles.filterPopoverActions}>
                      <div>
                        {activeFilter ? (
                          <s-button
                            command="--hide"
                            commandFor={FILTER_POPOVER_ID}
                            onClick={clearFilter}
                            variant="tertiary"
                          >
                            Clear filter
                          </s-button>
                        ) : null}
                      </div>
                      <s-stack direction="inline" gap="small">
                        <s-button
                          command="--hide"
                          commandFor={FILTER_POPOVER_ID}
                          onClick={resetDraftFilter}
                          variant="secondary"
                        >
                          Cancel
                        </s-button>
                        <s-button
                          command="--hide"
                          commandFor={FILTER_POPOVER_ID}
                          disabled={!draftFilterField || !draftFilterValue}
                          onClick={applyFilter}
                          variant="primary"
                        >
                          Add Filter
                        </s-button>
                      </s-stack>
                    </div>
                  </div>
                </s-box>
              </s-popover>
            </div>
            <div className={styles.searchArea}>
              <s-search-field
                label="Search products in this tab"
                labelAccessibilityVisibility="exclusive"
                onInput={(event) => {
                  const nextValue = event.currentTarget.value;
                  setSearchTerm(nextValue);

                  if (!normalizeDiagnosticsSearch(nextValue)) {
                    setDebouncedSearch("");
                  }
                }}
                placeholder="Start typing to search for products..."
                value={searchTerm}
              />
            </div>
            <div className={styles.sortSelect}>
              <PolarisOptionPicker
                accessibilityLabel="Sort products"
                disabled={isRefreshing}
                id={SORT_POPOVER_ID}
                onChange={changeSort}
                options={diagnosticsSortOptions}
                placeholder="Sort By"
                showSortIcon
                value={selectedSort}
              />
            </div>
          </div>

          <DiagnosticsTable
            canGoPrevious={navigation.index > 0}
            error={pageError}
            isLoading={pageLoading}
            isRefreshing={isRefreshing}
            onNext={loadNext}
            onPrevious={loadPrevious}
            onRefresh={refresh}
            pageIndex={navigation.index}
            pageInfo={page?.pageInfo}
            products={page?.products ?? []}
            searchTerm={searchTerm}
            totalProducts={page?.totalProducts ?? selectedTabTotal}
          />
        </div>
      </div>
    </div>
  );
}
