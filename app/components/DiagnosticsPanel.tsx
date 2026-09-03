import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import { flushSync } from "react-dom";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VscCircleSlash } from "react-icons/vsc";

import type {
  DiagnosticsCounts,
  DiagnosticsPage,
  DiagnosticsPageInfo,
  DiagnosticsTab,
} from "../services/diagnostics.server";
import {
  createDiagnosticsClientState,
  diagnosticsCollectionsQueryOptions,
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
  normalizeConfigurationText,
  type SelectedCollection,
} from "../services/configuration-validation";
import {
  configurationKeys,
  productTypeSuggestionsQueryOptions,
} from "../services/configuration-query";
import {
  diagnosticsFreeTextFilterFields,
  diagnosticsFilterFields,
  diagnosticsFilterLabels,
  diagnosticsStaticFilterOptions,
  normalizeDiagnosticsFilters,
  type DiagnosticsFilter,
  type DiagnosticsFilterField,
} from "../services/diagnostics-filter";
import { normalizeDiagnosticsSearch } from "../services/diagnostics-search";
import { filterProductTypeSuggestions } from "../services/product-type-suggestions";
import {
  DEFAULT_DIAGNOSTICS_PAGE_SIZE,
  DIAGNOSTICS_PAGE_SIZES,
  type DiagnosticsPageSize,
} from "../services/diagnostics-pagination";
import {
  DEFAULT_DIAGNOSTICS_SORT,
  normalizeDiagnosticsSort,
  type DiagnosticsSort,
} from "../services/diagnostics-sort";
import type { DiagnosticProduct } from "../services/diagnostics-validation";
import {
  createDiagnosticsBulkSelectionScope,
  diagnosticsBulkSelectionCount,
  diagnosticsPageSelectionState,
  emptyDiagnosticsBulkSelection,
  isDiagnosticsProductSelected,
  MAX_CUSTOM_LABEL_LENGTH,
  MAX_PRODUCT_TYPE_LENGTH,
  selectAllMatchingDiagnosticsProducts,
  serializeDiagnosticsBulkSelection,
  toggleDiagnosticsPage,
  toggleDiagnosticsProduct,
  undoAllMatchingDiagnosticsProducts,
  type DiagnosticsBulkEditRequest,
  type DiagnosticsBulkEditJob,
  type DiagnosticsBulkEdit,
  type DiagnosticsBulkSelection,
  type DiagnosticsBulkSelectionScope,
} from "../services/diagnostics-bulk-edit";
import {
  diagnosticsBulkEditStatusQueryOptions,
  requestDiagnosticsBulkEdit,
} from "../services/diagnostics-bulk-edit-query";
import styles from "../styles/diagnostics.module.css";
import { TabAlertNavigator, type TabAlert } from "./TabAlertNavigator";

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
const FILTER_ADD_POPOVER_ID = "diagnostics-filter-add-popover";
const FILTER_COLLECTION_POPOVER_ID = "diagnostics-filter-collection-popover";
const SORT_POPOVER_ID = "diagnostics-sort-popover";
const BULK_EDIT_POPOVER_ID = "diagnostics-bulk-edit-popover";
const PAGE_SIZE_POPOVER_ID = "diagnostics-page-size-popover";
const PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID =
  "diagnostics-product-type-suggestions-popover";
const BULK_EDIT_MODAL_ID = "diagnostics-bulk-edit-modal";
const CLEAR_BULK_EDIT_MODAL_ID = "diagnostics-clear-bulk-edit-confirmation";

type DiagnosticsBulkEditTarget =
  | { kind: "productType" }
  | { index: 0 | 1 | 2 | 3 | 4; kind: "customLabel" };

const customLabelTargets: Array<{
  index: 0 | 1 | 2 | 3 | 4;
  kind: "customLabel";
}> = [0, 1, 2, 3, 4].map((index) => ({
  index: index as 0 | 1 | 2 | 3 | 4,
  kind: "customLabel",
}));

function bulkEditFieldName(target: DiagnosticsBulkEditTarget) {
  return target.kind === "productType"
    ? "product type"
    : `custom_label_${target.index}`;
}

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
  activeJob: DiagnosticsBulkEditJob | null;
  bulkSelection: DiagnosticsBulkSelection;
  canGoPrevious: boolean;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  pageSize: DiagnosticsPageSize;
  pageIndex: number;
  pageInfo?: DiagnosticsPageInfo;
  products: DiagnosticProduct[];
  searchTerm: string;
  totalProducts?: number;
  onOpenBulkEdit: (target: DiagnosticsBulkEditTarget) => void;
  onNext: () => void;
  onPageSizeChange: (pageSize: DiagnosticsPageSize) => void;
  onPrevious: () => void;
  onRefresh: () => void;
  onSelectAllMatching: () => void;
  onTogglePage: (checked: boolean) => void;
  onToggleProduct: (productId: string, checked: boolean) => void;
  onUndoAllMatching: () => void;
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
            <s-text color={value ? "base" : "subdued"}>{selectedLabel}</s-text>
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

function SearchableFilterValuePicker({
  disabled,
  error,
  id,
  label,
  loading,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  error: boolean;
  id: string;
  label: string;
  loading: boolean;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
}) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const normalizedSearch = normalizeConfigurationText(search);
  const visibleOptions = options.filter(({ label: optionLabel, value }) =>
    `${optionLabel} ${value}`
      .toLocaleLowerCase()
      .includes(normalizedSearch.toLocaleLowerCase()),
  );
  const exactMatch = options.some(
    (option) =>
      option.value.toLocaleLowerCase() === normalizedSearch.toLocaleLowerCase(),
  );

  return (
    <div className={styles.polarisPicker}>
      <s-clickable
        accessibilityLabel={`Choose or enter ${label}`}
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
          <s-text color={value ? "base" : "subdued"}>
            {value || `Type or select ${label}`}
          </s-text>
          <s-icon color="subdued" type="chevron-down" />
        </span>
      </s-clickable>
      <s-popover
        id={id}
        inlineSize="320px"
        onHide={(event) => {
          event.stopPropagation();
          setSearch("");
        }}
        onShow={() => {
          setSearch(value);
          window.requestAnimationFrame(() => searchRef.current?.focus());
        }}
      >
        <s-box padding="small-200">
          <div className={styles.filterSuggestionDialog}>
            <s-search-field
              autocomplete="off"
              label={`Search ${label}`}
              labelAccessibilityVisibility="exclusive"
              onInput={(event) => {
                const nextValue = event.currentTarget.value;
                setSearch(nextValue);
                onChange(normalizeConfigurationText(nextValue));
              }}
              placeholder={`Search or enter ${label}`}
              ref={searchRef}
              value={search}
            />
            <div className={styles.filterSuggestionOptions} role="listbox">
              {normalizedSearch && !exactMatch ? (
                <s-button
                  command="--hide"
                  commandFor={id}
                  onClick={() => onChange(normalizedSearch)}
                  variant="tertiary"
                >
                  <span className={styles.polarisPickerOption}>
                    <span>Use &quot;{normalizedSearch}&quot;</span>
                    <s-icon type="plus" />
                  </span>
                </s-button>
              ) : null}
              {loading ? (
                <div className={styles.filterSuggestionState}>
                  <s-spinner
                    accessibilityLabel={`Loading ${label}`}
                    size="base"
                  />
                  <s-text color="subdued">Loading suggestions...</s-text>
                </div>
              ) : error ? (
                <div className={styles.filterSuggestionState}>
                  <s-text color="subdued">
                    Suggestions could not be loaded. You can still type a value.
                  </s-text>
                </div>
              ) : visibleOptions.length > 0 ? (
                visibleOptions.map((option) => (
                  <s-button
                    command="--hide"
                    commandFor={id}
                    key={`${option.value}-${option.label}`}
                    onClick={() => onChange(option.value)}
                    variant="tertiary"
                  >
                    <span className={styles.polarisPickerOption}>
                      <span>{option.label}</span>
                      {option.value === value ? <s-icon type="check" /> : null}
                    </span>
                  </s-button>
                ))
              ) : normalizedSearch ? null : (
                <div className={styles.filterSuggestionState}>
                  <s-text color="subdued">No suggestions found.</s-text>
                </div>
              )}
            </div>
          </div>
        </s-box>
      </s-popover>
    </div>
  );
}

function DiagnosticsFilterValuePicker({
  collection,
  disabled,
  endpoint,
  field,
  generation,
  onChange,
  onCollectionChange,
  scope,
  snapshotVersion,
  tab,
  value,
}: {
  collection: SelectedCollection | null;
  disabled: boolean;
  endpoint: string;
  field: DiagnosticsFilterField;
  generation: number;
  onChange: (value: string) => void;
  onCollectionChange: (collection: SelectedCollection) => void;
  scope: DiagnosticsQueryScope;
  snapshotVersion: string | null;
  tab: DiagnosticsTab;
  value: string;
}) {
  const staticOptions = diagnosticsStaticFilterOptions[field];
  const optionsQuery = useQuery({
    ...diagnosticsFilterOptionsQueryOptions(
      scope,
      generation,
      tab,
      field,
      snapshotVersion,
      { endpoint },
    ),
    enabled:
      !disabled &&
      field !== "collection" &&
      !staticOptions &&
      Boolean(snapshotVersion),
  });
  const options = staticOptions ?? optionsQuery.data?.options ?? [];
  const pickerId = `diagnostics-filter-value-${field}`;

  if (field === "collection") {
    return (
      <CollectionFilterPicker
        disabled={disabled}
        endpoint={endpoint}
        onChange={onCollectionChange}
        scope={scope}
        value={collection}
      />
    );
  }

  if (diagnosticsFreeTextFilterFields.has(field)) {
    return (
      <SearchableFilterValuePicker
        disabled={disabled}
        error={optionsQuery.isError}
        id={pickerId}
        label={diagnosticsFilterLabels[field]}
        loading={optionsQuery.isPending}
        onChange={onChange}
        options={options}
        value={value}
      />
    );
  }

  return (
    <div className={styles.filterConditionValue}>
      <PolarisOptionPicker
        accessibilityLabel={`Select ${diagnosticsFilterLabels[field]}`}
        disabled={
          disabled ||
          (!staticOptions &&
            (optionsQuery.isPending ||
              optionsQuery.isError ||
              options.length === 0))
        }
        id={pickerId}
        onChange={onChange}
        options={options}
        placeholder={
          optionsQuery.isPending && !staticOptions
            ? "Loading values..."
            : `Select ${diagnosticsFilterLabels[field]}...`
        }
        value={value}
      />
      {optionsQuery.isError ? (
        <s-text tone="critical">Filter values couldn&apos;t be loaded.</s-text>
      ) : null}
    </div>
  );
}

function CollectionFilterPicker({
  disabled,
  endpoint,
  onChange,
  scope,
  value,
}: {
  disabled: boolean;
  endpoint: string;
  onChange: (collection: SelectedCollection) => void;
  scope: DiagnosticsQueryScope;
  value: SelectedCollection | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [results, setResults] = useState<SelectedCollection[]>([]);
  const searchRef = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const query = useQuery({
    ...diagnosticsCollectionsQueryOptions(scope, debouncedSearch, cursor, {
      endpoint,
    }),
    enabled: open && !disabled,
  });

  useEffect(() => {
    const normalized = normalizeConfigurationText(search);
    if (!normalized) {
      setDebouncedSearch("");
      return;
    }

    const timer = window.setTimeout(() => setDebouncedSearch(normalized), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCursor(null);
    setResults([]);
  }, [debouncedSearch]);

  useEffect(() => {
    const page = query.data;
    if (
      !open ||
      !page ||
      normalizeConfigurationText(page.search) !==
        normalizeConfigurationText(debouncedSearch)
    ) {
      return;
    }

    setResults((current) => {
      const next = cursor ? [...current] : [];
      const seen = new Set(next.map(({ id }) => id));
      for (const collection of page.collections) {
        if (!seen.has(collection.id)) {
          seen.add(collection.id);
          next.push(collection);
        }
      }
      return next;
    });
  }, [cursor, debouncedSearch, open, query.data]);

  const loadNextPage = () => {
    const pageInfo = query.data?.pageInfo;
    if (
      query.isFetching ||
      !pageInfo?.hasNextPage ||
      !pageInfo.endCursor ||
      pageInfo.endCursor === cursor
    ) {
      return;
    }
    setCursor(pageInfo.endCursor);
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 24) {
      loadNextPage();
    }
  };

  return (
    <div className={styles.polarisPicker}>
      <s-clickable
        accessibilityLabel="Select Collection"
        background="base"
        blockSize="32px"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={FILTER_COLLECTION_POPOVER_ID}
        disabled={disabled}
        inlineSize="100%"
        padding="none"
      >
        <span className={styles.pickerTriggerContent}>
          <span className={styles.pickerTriggerLabel}>
            <s-text color={value ? "base" : "subdued"}>
              {value?.title ?? "Select Collection..."}
            </s-text>
          </span>
          <s-icon color="subdued" type="chevron-down" />
        </span>
      </s-clickable>
      <s-popover
        id={FILTER_COLLECTION_POPOVER_ID}
        inlineSize="336px"
        onHide={() => setOpen(false)}
        onShow={() => {
          setOpen(true);
          setSearch("");
          setDebouncedSearch("");
          setCursor(null);
          setResults([]);
          window.requestAnimationFrame(() => searchRef.current?.focus());
        }}
      >
        <s-box padding="small-200">
          <div className={styles.collectionPickerContent}>
            <s-search-field
              label="Search store collections"
              labelAccessibilityVisibility="exclusive"
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search collections"
              ref={searchRef}
              value={search}
            />
            <div
              aria-label="Store collections"
              className={styles.collectionPickerResults}
              onScroll={handleScroll}
              role="list"
            >
              {query.isPending && results.length === 0 ? (
                <div className={styles.collectionPickerState}>
                  <s-spinner
                    accessibilityLabel="Loading collections"
                    size="base"
                  />
                </div>
              ) : query.isError && results.length === 0 ? (
                <div className={styles.collectionPickerState}>
                  <s-text color="subdued">
                    Collections could not be loaded.
                  </s-text>
                  <s-button onClick={() => query.refetch()} variant="secondary">
                    Retry
                  </s-button>
                </div>
              ) : results.length === 0 ? (
                <div className={styles.collectionPickerState}>
                  <s-text color="subdued">No collections found.</s-text>
                </div>
              ) : (
                results.map((collection) => (
                  <s-button
                    command="--hide"
                    commandFor={FILTER_COLLECTION_POPOVER_ID}
                    icon="collection"
                    key={collection.id}
                    onClick={() => onChange(collection)}
                    variant="tertiary"
                  >
                    <span className={styles.collectionPickerOption}>
                      <span>{collection.title}</span>
                      {value?.id === collection.id ? (
                        <s-icon type="check" />
                      ) : null}
                    </span>
                  </s-button>
                ))
              )}
              {query.isError && results.length > 0 ? (
                <div className={styles.collectionPickerLoadingMore}>
                  <s-text color="subdued">
                    More collections could not be loaded.
                  </s-text>
                  <s-button onClick={() => query.refetch()} variant="tertiary">
                    Retry
                  </s-button>
                </div>
              ) : query.isFetching && results.length > 0 ? (
                <div className={styles.collectionPickerLoadingMore}>
                  <s-spinner
                    accessibilityLabel="Loading more collections"
                    size="base"
                  />
                  <s-text color="subdued">Loading more...</s-text>
                </div>
              ) : null}
            </div>
          </div>
        </s-box>
      </s-popover>
    </div>
  );
}

function ProductTypeSelector({
  disabled,
  loading,
  onChange,
  productTypes,
  value,
}: {
  disabled: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  productTypes: string[];
  value: string;
}) {
  const [suggestionSearch, setSuggestionSearch] = useState("");
  const [popoverInlineSize, setPopoverInlineSize] =
    useState<`${number}px`>("520px");
  const selectorRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const normalizedSearch = normalizeConfigurationText(suggestionSearch).slice(
    0,
    MAX_PRODUCT_TYPE_LENGTH,
  );
  const visibleProductTypes = filterProductTypeSuggestions(
    productTypes,
    normalizedSearch,
  );
  const selectedProductType = productTypes.find(
    (productType) =>
      productType.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
  );
  const exactSearchMatch = productTypes.some(
    (productType) =>
      productType.toLocaleLowerCase() === normalizedSearch.toLocaleLowerCase(),
  );
  const syncPopoverWidth = () => {
    const width = selectorRef.current?.getBoundingClientRect().width;
    if (width) setPopoverInlineSize(`${Math.round(width)}px`);
  };

  return (
    <div className={styles.productTypeSelector} ref={selectorRef}>
      <s-text>Product type</s-text>
      <s-clickable
        accessibilityLabel="Choose or enter a product type"
        background="base"
        blockSize="38px"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID}
        disabled={disabled}
        inlineSize="100%"
        onClick={syncPopoverWidth}
        padding="small-200 base"
      >
        <span className={styles.productTypeTriggerContent}>
          <s-text color={value ? "base" : "subdued"}>
            {value || "Type or select a product type"}
          </s-text>
          <span className={styles.productTypeTriggerMeta}>
            {value.length}/{MAX_PRODUCT_TYPE_LENGTH}
            <s-icon color="subdued" type="chevron-down" />
          </span>
        </span>
      </s-clickable>

      <s-popover
        id={PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID}
        inlineSize={popoverInlineSize}
        onHide={(event) => {
          event.stopPropagation();
          setSuggestionSearch("");
        }}
        onShow={() => {
          syncPopoverWidth();
          setSuggestionSearch(value);
          window.requestAnimationFrame(() => searchRef.current?.focus());
        }}
      >
        <s-box padding="small-200">
          <div className={styles.productTypeSuggestionDialog}>
            <s-search-field
              autocomplete="off"
              label="Search product types"
              labelAccessibilityVisibility="exclusive"
              maxLength={MAX_PRODUCT_TYPE_LENGTH}
              onInput={(event) => {
                const nextValue = event.currentTarget.value;
                setSuggestionSearch(nextValue);
                onChange(
                  normalizeConfigurationText(nextValue).slice(
                    0,
                    MAX_PRODUCT_TYPE_LENGTH,
                  ),
                );
              }}
              placeholder="Search product types"
              ref={searchRef}
              value={suggestionSearch}
            />
            <div
              aria-label="Available product types"
              className={styles.productTypeSuggestionOptions}
              role="region"
            >
              {normalizedSearch && !exactSearchMatch ? (
                <s-button
                  command="--hide"
                  commandFor={PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID}
                  onClick={() => onChange(normalizedSearch)}
                  variant="tertiary"
                >
                  <span className={styles.productTypeSuggestion}>
                    <span>Use &quot;{normalizedSearch}&quot;</span>
                    <s-icon type="plus" />
                  </span>
                </s-button>
              ) : null}
              {loading ? (
                <div className={styles.productTypeSuggestionState}>
                  <s-spinner
                    accessibilityLabel="Loading product type suggestions"
                    size="base"
                  />
                  <s-text color="subdued">Loading product types...</s-text>
                </div>
              ) : visibleProductTypes.length > 0 ? (
                visibleProductTypes.map((productType) => (
                  <s-button
                    accessibilityLabel={`Use ${productType} as the product type`}
                    command="--hide"
                    commandFor={PRODUCT_TYPE_SUGGESTIONS_POPOVER_ID}
                    key={productType.toLocaleLowerCase()}
                    onClick={() => onChange(productType)}
                    variant="tertiary"
                  >
                    <span className={styles.productTypeSuggestion}>
                      <span>{productType}</span>
                      {selectedProductType === productType ? (
                        <s-icon type="check" />
                      ) : null}
                    </span>
                  </s-button>
                ))
              ) : normalizedSearch ? null : (
                <div className={styles.productTypeSuggestionState}>
                  <s-text color="subdued">
                    No product type suggestions found. Search to use a new
                    product type.
                  </s-text>
                </div>
              )}
            </div>
          </div>
        </s-box>
      </s-popover>
    </div>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function isActiveBulkEditJob(job: DiagnosticsBulkEditJob | null | undefined) {
  return job?.status === "QUEUED" || job?.status === "PROCESSING";
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
  const statusImage =
    status === "submitted"
      ? {
          alt: "Submitted with no warnings",
          src: "/correct.png",
          title: "Submitted with no warnings or errors",
        }
      : status === "warning"
        ? {
            alt: "Submitted with warnings",
            src: "/warning.png",
            title: "Submitted with warnings",
          }
        : {
            alt: "Excluded because of errors",
            src: "/cross.png",
            title: "Excluded because of errors",
          };

  return (
    <img
      alt={statusImage.alt}
      className={styles.statusImage}
      src={statusImage.src}
      title={statusImage.title}
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
  activeJob,
  bulkSelection,
  canGoPrevious,
  error,
  isLoading,
  isRefreshing,
  pageSize,
  pageIndex,
  pageInfo,
  products,
  searchTerm,
  totalProducts,
  onOpenBulkEdit,
  onNext,
  onPageSizeChange,
  onPrevious,
  onRefresh,
  onSelectAllMatching,
  onTogglePage,
  onToggleProduct,
  onUndoAllMatching,
}: DiagnosticsTableProps) {
  const emptyMessage = normalizeDiagnosticsSearch(searchTerm)
    ? "No products match your search."
    : "No products are available in this view.";
  const firstProduct = products.length === 0 ? 0 : pageIndex * pageSize + 1;
  const lastProduct =
    products.length === 0 ? 0 : firstProduct + products.length - 1;
  const displayedProductIds = products.map(({ id }) => id);
  const pageSelection = diagnosticsPageSelectionState(
    bulkSelection,
    displayedProductIds,
  );
  const selectedCount = diagnosticsBulkSelectionCount(bulkSelection);
  const bulkMode = selectedCount > 0;
  const selectionLocked = isActiveBulkEditJob(activeJob);
  const canSelectAllMatching =
    bulkSelection.mode === "explicit" &&
    pageSelection.checked &&
    Boolean(totalProducts && totalProducts > products.length);

  return (
    <>
      <div className={styles.tableSummary}>
        <span aria-live="polite">
          {isLoading
            ? "Loading products"
            : `Showing ${formatCount(firstProduct)} to ${formatCount(
                lastProduct,
              )} of ${formatCount(totalProducts ?? products.length)} Products`}
        </span>
      </div>

      <div className={styles.tableViewport}>
        <table className={styles.diagnosticsTable}>
          <colgroup>
            <col className={styles.productColumn} />
            <col className={styles.categoryColumn} />
            <col className={styles.productTypeColumn} />
            <col className={styles.statusColumn} />
            <col className={styles.errorColumn} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <div className={styles.productHeader}>
                  <s-checkbox
                    accessibilityLabel="Select all products on this page"
                    checked={pageSelection.checked}
                    disabled={
                      isLoading || products.length === 0 || selectionLocked
                    }
                    indeterminate={pageSelection.indeterminate}
                    onChange={(event) =>
                      onTogglePage(event.currentTarget.checked)
                    }
                  />
                  <span>Product</span>
                  {bulkSelection.mode === "allMatching" ? (
                    <s-button
                      disabled={selectionLocked}
                      onClick={onUndoAllMatching}
                      variant="tertiary"
                    >
                      <span className={styles.underlinedAction}>Undo</span>
                    </s-button>
                  ) : canSelectAllMatching ? (
                    <s-button onClick={onSelectAllMatching} variant="tertiary">
                      <span className={styles.underlinedAction}>
                        Select all products
                      </span>
                    </s-button>
                  ) : null}
                  {bulkMode ? (
                    <span aria-live="polite" className={styles.selectionCount}>
                      {formatCount(selectedCount)} product
                      {selectedCount === 1 ? "" : "s"} selected
                    </span>
                  ) : null}
                </div>
              </th>
              {bulkMode ? (
                <th colSpan={4} scope="col">
                  <div className={styles.bulkHeaderActions}>
                    <s-button
                      accessibilityLabel="Bulk edit selected products"
                      command="--show"
                      commandFor={BULK_EDIT_POPOVER_ID}
                      disabled={selectionLocked}
                      variant="secondary"
                    >
                      <span className={styles.bulkEditButtonContent}>
                        Bulk edit
                        <s-icon type="chevron-down" />
                      </span>
                    </s-button>
                    <s-popover id={BULK_EDIT_POPOVER_ID}>
                      <s-box padding="small-200">
                        <div className={styles.bulkEditActions}>
                          <s-button
                            command="--hide"
                            commandFor={BULK_EDIT_POPOVER_ID}
                            onClick={() =>
                              onOpenBulkEdit({ kind: "productType" })
                            }
                            variant="tertiary"
                          >
                            Assign product type
                          </s-button>
                          {customLabelTargets.map((target) => (
                            <s-button
                              command="--hide"
                              commandFor={BULK_EDIT_POPOVER_ID}
                              key={target.index}
                              onClick={() => onOpenBulkEdit(target)}
                              variant="tertiary"
                            >
                              Assign custom_label_{target.index}
                            </s-button>
                          ))}
                        </div>
                      </s-box>
                    </s-popover>
                  </div>
                </th>
              ) : (
                <>
                  <th scope="col">
                    <span className={styles.categoryColumnAnchor}>
                      Google product category
                    </span>
                  </th>
                  <th scope="col">Product type</th>
                  <th className={styles.googleHeader} scope="col">
                    <img alt="Google" src="/google-icon.png" />
                  </th>
                  <th scope="col">
                    <div className={styles.errorHeader}>
                      <span>Error from Multi-Sync</span>
                      <s-button
                        accessibilityLabel="Refresh product errors"
                        disabled={isRefreshing}
                        icon="refresh"
                        loading={isRefreshing ? true : undefined}
                        onClick={onRefresh}
                        tone="critical"
                        variant="primary"
                      >
                        Refresh Product Errors
                      </s-button>
                    </div>
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : error && products.length === 0 ? (
              <tr>
                <td className={styles.emptyCell} colSpan={5}>
                  {error}
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td className={styles.emptyCell} colSpan={5}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className={styles.productCell}>
                      <s-checkbox
                        accessibilityLabel={`Select ${product.title || "untitled product"}`}
                        checked={isDiagnosticsProductSelected(
                          bulkSelection,
                          product.id,
                        )}
                        disabled={selectionLocked}
                        onChange={(event) =>
                          onToggleProduct(
                            product.id,
                            event.currentTarget.checked,
                          )
                        }
                      />
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
                  <td>
                    <span
                      className={styles.productTypeValue}
                      title={product.productType ?? "No product type assigned"}
                    >
                      {product.productType || "—"}
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
        <div className={styles.pageSizeControl}>
          <s-button
            accessibilityLabel="Products displayed per page"
            command="--show"
            commandFor={PAGE_SIZE_POPOVER_ID}
            disabled={isLoading || isRefreshing}
            variant="secondary"
          >
            <span className={styles.pageSizeButtonContent}>
              {pageSize}
              <s-icon type="chevron-down" />
            </span>
          </s-button>
          <s-popover id={PAGE_SIZE_POPOVER_ID}>
            <s-box padding="small-100">
              <div className={styles.pageSizeOptions}>
                {DIAGNOSTICS_PAGE_SIZES.map((option) => (
                  <s-button
                    command="--hide"
                    commandFor={PAGE_SIZE_POPOVER_ID}
                    key={option}
                    onClick={() => onPageSizeChange(option)}
                    variant="tertiary"
                  >
                    {option}
                  </s-button>
                ))}
              </div>
            </s-box>
          </s-popover>
        </div>
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
        <span aria-hidden="true" className={styles.paginationSpacer} />
      </div>
    </>
  );
}

export function DiagnosticsPanel({
  active,
  dataEndpoint = "/app/diagnostics-data",
  scope,
}: DiagnosticsPanelProps) {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const queryScope = scope ?? {
    shop: "pending-shop",
    sessionId: "pending-session",
  };
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const bulkEditModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const clearBulkEditModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const handledBulkJobs = useRef(new Set<string>());
  const observedActiveBulkJobs = useRef(new Set<string>());
  const [selectedTab, setSelectedTab] = useState<DiagnosticsTab>("all");
  const [bulkSelection, setBulkSelection] = useState<DiagnosticsBulkSelection>(
    emptyDiagnosticsBulkSelection,
  );
  const [bulkEditTarget, setBulkEditTarget] =
    useState<DiagnosticsBulkEditTarget>({ kind: "productType" });
  const [bulkEditValue, setBulkEditValue] = useState("");
  const [bulkEditError, setBulkEditError] = useState<string | null>(null);
  const [bulkEditModalOpen, setBulkEditModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<DiagnosticsFilter[]>([]);
  const [draftFilterField, setDraftFilterField] =
    useState<DiagnosticsFilterField | null>(null);
  const [draftFilterValue, setDraftFilterValue] = useState("");
  const [activeCollection, setActiveCollection] =
    useState<SelectedCollection | null>(null);
  const [draftCollection, setDraftCollection] =
    useState<SelectedCollection | null>(null);
  const [selectedSort, setSelectedSort] = useState<DiagnosticsSort | "">("");
  const [pageSize, setPageSize] = useState<DiagnosticsPageSize>(
    DEFAULT_DIAGNOSTICS_PAGE_SIZE,
  );
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
  const productTypeSuggestionsQuery = useQuery({
    ...productTypeSuggestionsQueryOptions(queryScope),
    enabled:
      queriesEnabled &&
      bulkEditModalOpen &&
      bulkEditTarget.kind === "productType",
  });
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
      filters: activeFilters,
      force: isRefreshing,
      pageSize,
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
  const bulkEditStatusQuery = useQuery({
    ...diagnosticsBulkEditStatusQueryOptions(queryScope),
    enabled: Boolean(scope),
    refetchInterval: (query) =>
      active && isActiveBulkEditJob(query.state.data) ? 2_000 : false,
  });
  const activeBulkJob = bulkEditStatusQuery.data ?? null;
  const bulkEditMutation = useMutation({
    mutationFn: (request: DiagnosticsBulkEditRequest) =>
      requestDiagnosticsBulkEdit(request),
    onSuccess: (job) => {
      queryClient.setQueryData(
        diagnosticsBulkEditStatusQueryOptions(queryScope).queryKey,
        job,
      );
      setBulkEditError(null);
      bulkEditModalRef.current?.hideOverlay();
      clearBulkEditModalRef.current?.hideOverlay();
      const fieldName = bulkEditFieldName(job.edit);
      shopify.toast.show(
        job.edit.value
          ? `${fieldName} is being added.`
          : `${fieldName} is being cleared.`,
      );
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : "The catalog bulk edit could not be started.";
      setBulkEditError(message);
      shopify.toast.show(message, { isError: true });
    },
  });
  const selectedTabDefinition = diagnosticTabs.find(
    ({ id }) => id === selectedTab,
  );
  const selectedTabTotal =
    storeWideCounts?.hasSnapshot && selectedTabDefinition
      ? storeWideCounts[selectedTabDefinition.countKey]
      : undefined;
  const currentSelectionScope = useMemo<DiagnosticsBulkSelectionScope>(
    () =>
      createDiagnosticsBulkSelectionScope({
        diagnosticsTab: selectedTab,
        filters: activeFilters,
        search: normalizedSearch,
        snapshotVersion: page?.scanVersion ?? "",
      }),
    [activeFilters, normalizedSearch, page?.scanVersion, selectedTab],
  );
  const filterSnapshotVersion =
    page?.scanVersion ?? storeWideCounts?.scanVersion ?? null;

  useEffect(() => {
    setBulkSelection(emptyDiagnosticsBulkSelection());
    setBulkEditError(null);
  }, [scope?.shop]);

  useEffect(() => {
    const job = bulkEditStatusQuery.data;
    if (!scope || !job) {
      return;
    }
    if (isActiveBulkEditJob(job)) {
      observedActiveBulkJobs.current.add(job.id);
      return;
    }
    if (
      handledBulkJobs.current.has(job.id) ||
      !observedActiveBulkJobs.current.has(job.id)
    ) {
      return;
    }
    handledBulkJobs.current.add(job.id);

    if (job.status === "COMPLETED") {
      setBulkSelection(emptyDiagnosticsBulkSelection());
      setBulkEditError(null);
      bulkEditModalRef.current?.hideOverlay();
      clearBulkEditModalRef.current?.hideOverlay();
      if (job.edit.kind === "productType") {
        void queryClient.invalidateQueries({
          queryKey: diagnosticsKeys.shop(scope.shop),
        });
        void queryClient
          .invalidateQueries({
            exact: true,
            queryKey: configurationKeys.productTypes(scope),
            refetchType: "none",
          })
          .then(() =>
            queryClient.fetchQuery(
              productTypeSuggestionsQueryOptions(scope, { force: true }),
            ),
          )
          .catch(() => undefined);
      }
      const fieldName = bulkEditFieldName(job.edit);
      shopify.toast.show(
        job.edit.value
          ? `${fieldName} added to ${formatCount(job.successfulCount)} products.`
          : `${fieldName} cleared from ${formatCount(job.successfulCount)} products.`,
      );
    } else if (job.status === "PARTIALLY_COMPLETED") {
      setBulkSelection(emptyDiagnosticsBulkSelection());
      bulkEditModalRef.current?.hideOverlay();
      clearBulkEditModalRef.current?.hideOverlay();
      if (job.edit.kind === "productType") {
        void queryClient.invalidateQueries({
          queryKey: diagnosticsKeys.shop(scope.shop),
        });
        void queryClient
          .invalidateQueries({
            exact: true,
            queryKey: configurationKeys.productTypes(scope),
            refetchType: "none",
          })
          .then(() =>
            queryClient.fetchQuery(
              productTypeSuggestionsQueryOptions(scope, { force: true }),
            ),
          )
          .catch(() => undefined);
      }
      shopify.toast.show(
        `${formatCount(job.successfulCount)} products updated. ${formatCount(job.failedCount)} products could not be updated.`,
        { isError: true },
      );
    } else {
      const message =
        job.errorSamples[0] ??
        "The catalog bulk edit failed. Your selection is still available.";
      setBulkEditError(message);
      shopify.toast.show(message, { isError: true });
    }
  }, [bulkEditStatusQuery.data, queryClient, scope, shopify]);

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
        filters: activeFilters,
        pageSize,
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
    activeFilters,
    activeSort,
    clientState.generation,
    dataEndpoint,
    isRefreshing,
    normalizedSearch,
    pageSize,
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

  const clearSelectionForScopeChange = () => {
    if (diagnosticsBulkSelectionCount(bulkSelection) === 0) return;
    setBulkSelection(emptyDiagnosticsBulkSelection());
    bulkEditModalRef.current?.hideOverlay();
    clearBulkEditModalRef.current?.hideOverlay();
    shopify.toast.show(
      "Product selection cleared because the Diagnostics scope changed.",
    );
  };

  const selectTab = (tab: DiagnosticsTab, index?: number) => {
    if (tab !== selectedTab) clearSelectionForScopeChange();
    setSelectedTab(tab);
    setSearchTerm("");
    setDebouncedSearch("");

    if (index !== undefined) {
      tabRefs.current[index]?.focus();
    }
  };

  const toggleProductSelection = (productId: string, checked: boolean) => {
    setBulkSelection((selection) =>
      toggleDiagnosticsProduct(selection, productId, checked),
    );
  };

  const togglePageSelection = (checked: boolean) => {
    const productIds = (page?.products ?? []).map(({ id }) => id);
    setBulkSelection((selection) =>
      toggleDiagnosticsPage(selection, productIds, checked),
    );
  };

  const selectAllMatching = () => {
    if (!page?.scanVersion || !page.totalProducts) return;
    setBulkSelection(
      selectAllMatchingDiagnosticsProducts(
        currentSelectionScope,
        page.totalProducts,
      ),
    );
  };

  const undoAllMatching = () => {
    const productIds = (page?.products ?? []).map(({ id }) => id);
    setBulkSelection((selection) =>
      undoAllMatchingDiagnosticsProducts(selection, productIds),
    );
  };

  const openBulkEditModal = (target: DiagnosticsBulkEditTarget) => {
    setBulkEditTarget(target);
    setBulkEditValue("");
    setBulkEditError(null);
    setBulkEditModalOpen(true);
    window.setTimeout(() => bulkEditModalRef.current?.showOverlay());
  };

  const submitBulkEdit = () => {
    if (
      diagnosticsBulkSelectionCount(bulkSelection) === 0 ||
      !currentSelectionScope.snapshotVersion ||
      isActiveBulkEditJob(activeBulkJob)
    ) {
      return;
    }
    const edit: DiagnosticsBulkEdit =
      bulkEditTarget.kind === "productType"
        ? { kind: "productType", value: bulkEditValue }
        : {
            index: bulkEditTarget.index,
            kind: "customLabel",
            value: bulkEditValue,
          };
    bulkEditMutation.mutate(
      serializeDiagnosticsBulkSelection(
        bulkSelection,
        currentSelectionScope,
        edit,
        crypto.randomUUID(),
      ),
    );
  };

  const applyBulkEdit = () => {
    if (bulkEditValue.trim()) {
      submitBulkEdit();
      return;
    }
    bulkEditModalRef.current?.hideOverlay();
    window.setTimeout(() => clearBulkEditModalRef.current?.showOverlay());
  };

  const cancelBulkEditClear = () => {
    clearBulkEditModalRef.current?.hideOverlay();
    setBulkEditModalOpen(true);
    window.setTimeout(() => bulkEditModalRef.current?.showOverlay());
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

    clearSelectionForScopeChange();

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
            filters: activeFilters,
            pageSize,
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

  const changePageSize = (nextPageSize: DiagnosticsPageSize) => {
    if (nextPageSize === pageSize) return;
    setPageSize(nextPageSize);
    storeClientState(createDiagnosticsClientState(clientState.generation));
  };

  const changeSort = (value: string) => {
    const nextSort = normalizeDiagnosticsSort(value);
    setSelectedSort(nextSort);

    if (nextSort !== activeSort) {
      storeClientState(createDiagnosticsClientState(clientState.generation));
    }
  };

  const resetDraftFilter = () => {
    setDraftFilterField(null);
    setDraftFilterValue("");
    setDraftCollection(null);
  };

  const changeDraftFilterField = (value: string) => {
    const field = value as DiagnosticsFilterField;
    setDraftFilterField(field);
    setDraftFilterValue("");
    setDraftCollection(null);
  };

  const changeDraftCollection = (collection: SelectedCollection) => {
    setDraftCollection(collection);
    setDraftFilterValue(collection.id);
  };

  const addFilter = () => {
    if (!draftFilterField || !draftFilterValue.trim()) {
      return;
    }
    const nextFilters = normalizeDiagnosticsFilters([
      ...activeFilters,
      { field: draftFilterField, value: draftFilterValue },
    ]);

    clearSelectionForScopeChange();
    setActiveFilters(nextFilters);
    setActiveCollection(
      draftFilterField === "collection" ? draftCollection : activeCollection,
    );
    resetDraftFilter();
    storeClientState(createDiagnosticsClientState(clientState.generation));
  };

  const removeFilter = (field: DiagnosticsFilterField) => {
    clearSelectionForScopeChange();
    setActiveFilters((current) =>
      current.filter((filter) => filter.field !== field),
    );
    if (field === "collection") setActiveCollection(null);
    storeClientState(createDiagnosticsClientState(clientState.generation));
  };

  const clearFilters = () => {
    if (activeFilters.length > 0) clearSelectionForScopeChange();
    setActiveFilters([]);
    resetDraftFilter();
    setActiveCollection(null);
    storeClientState(createDiagnosticsClientState(clientState.generation));
  };

  const availableFilterOptions = diagnosticsFilterFieldOptions.filter(
    ({ value }) => !activeFilters.some(({ field }) => field === value),
  );

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
  const selectedProductCount = diagnosticsBulkSelectionCount(bulkSelection);
  const activeJobInProgress = isActiveBulkEditJob(activeBulkJob);
  const bulkEditField = bulkEditFieldName(bulkEditTarget);
  const bulkEditMaxLength =
    bulkEditTarget.kind === "productType"
      ? MAX_PRODUCT_TYPE_LENGTH
      : MAX_CUSTOM_LABEL_LENGTH;

  return (
    <div className={styles.diagnostics}>
      {tabAlerts.length > 0 ? (
        <div className={styles.errorBanner}>
          <TabAlertNavigator alerts={tabAlerts} />
        </div>
      ) : null}

      {bulkEditError ? (
        <div className={styles.bulkJobBanner}>
          <s-banner heading="Catalog bulk edit needs attention" tone="critical">
            <s-paragraph>{bulkEditError}</s-paragraph>
          </s-banner>
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
                      Filter Products
                      {activeFilters.length > 0
                        ? ` (${activeFilters.length})`
                        : ""}
                    </s-text>
                  </span>
                  <s-icon color="subdued" type="chevron-down" />
                </span>
              </s-clickable>
              <s-popover id={FILTER_POPOVER_ID} inlineSize="400px">
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
                      disabled={availableFilterOptions.length === 0}
                      id={FILTER_ADD_POPOVER_ID}
                      onChange={changeDraftFilterField}
                      options={availableFilterOptions}
                      placeholder={
                        availableFilterOptions.length > 0
                          ? "Select Filter..."
                          : "All filters are active"
                      }
                      value={draftFilterField ?? ""}
                    />

                    {draftFilterField ? (
                      <div className={styles.filterCondition}>
                        <s-text>is</s-text>
                        <DiagnosticsFilterValuePicker
                          collection={draftCollection}
                          disabled={!queriesEnabled}
                          endpoint={dataEndpoint}
                          field={draftFilterField}
                          generation={clientState.generation}
                          onChange={setDraftFilterValue}
                          onCollectionChange={changeDraftCollection}
                          scope={queryScope}
                          snapshotVersion={filterSnapshotVersion}
                          tab={selectedTab}
                          value={draftFilterValue}
                        />
                      </div>
                    ) : null}

                    <div className={styles.filterPopoverActions}>
                      <div>
                        {activeFilters.length > 0 ? (
                          <s-button
                            command="--hide"
                            commandFor={FILTER_POPOVER_ID}
                            onClick={clearFilters}
                            variant="tertiary"
                          >
                            Clear filters
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
                          disabled={
                            !draftFilterField || !draftFilterValue.trim()
                          }
                          onClick={addFilter}
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
                  if (
                    normalizeDiagnosticsSearch(nextValue) !== normalizedSearch
                  ) {
                    clearSelectionForScopeChange();
                  }
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

          {activeFilters.length > 0 ? (
            <div
              aria-label="Active product filters"
              className={styles.activeFiltersBar}
            >
              {activeFilters.map((filter) => (
                <s-button
                  accessibilityLabel={`Remove ${diagnosticsFilterLabels[filter.field]} filter`}
                  icon="x"
                  key={filter.field}
                  onClick={() => removeFilter(filter.field)}
                  variant="secondary"
                >
                  {diagnosticsFilterLabels[filter.field]}:{" "}
                  {filter.field === "collection"
                    ? (activeCollection?.title ?? filter.value)
                    : filter.value}
                </s-button>
              ))}
              <s-button onClick={clearFilters} variant="tertiary">
                Clear filters
              </s-button>
            </div>
          ) : null}

          <DiagnosticsTable
            activeJob={activeBulkJob}
            bulkSelection={bulkSelection}
            canGoPrevious={navigation.index > 0}
            error={pageError}
            isLoading={pageLoading}
            isRefreshing={isRefreshing}
            onOpenBulkEdit={openBulkEditModal}
            onNext={loadNext}
            onPageSizeChange={changePageSize}
            onPrevious={loadPrevious}
            onRefresh={refresh}
            onSelectAllMatching={selectAllMatching}
            onTogglePage={togglePageSelection}
            onToggleProduct={toggleProductSelection}
            onUndoAllMatching={undoAllMatching}
            pageSize={pageSize}
            pageIndex={navigation.index}
            pageInfo={page?.pageInfo}
            products={page?.products ?? []}
            searchTerm={searchTerm}
            totalProducts={page?.totalProducts ?? selectedTabTotal}
          />
        </div>
      </div>

      <s-modal
        accessibilityLabel={`Assign ${bulkEditField} to selected products`}
        heading={`Assign ${bulkEditField}`}
        id={BULK_EDIT_MODAL_ID}
        onHide={(event) => {
          if (event.target === event.currentTarget) {
            setBulkEditModalOpen(false);
          }
        }}
        padding="none"
        ref={bulkEditModalRef}
        size="base"
      >
        <s-box padding="base">
          <div className={styles.productTypeModalContent}>
            {bulkEditError ? (
              <s-banner
                heading="The bulk edit could not be started"
                tone="critical"
              >
                <s-paragraph>{bulkEditError}</s-paragraph>
              </s-banner>
            ) : null}
            {bulkEditTarget.kind === "productType" ? (
              <>
                <ProductTypeSelector
                  disabled={activeJobInProgress || bulkEditMutation.isPending}
                  loading={productTypeSuggestionsQuery.isPending}
                  onChange={(value) => {
                    setBulkEditValue(value);
                    setBulkEditError(null);
                  }}
                  productTypes={productTypeSuggestionsQuery.data ?? []}
                  value={bulkEditValue}
                />
                {productTypeSuggestionsQuery.isError ? (
                  <s-banner
                    heading="Product type suggestions are unavailable"
                    tone="warning"
                  >
                    <s-paragraph>
                      You can still type and apply a new product type.
                    </s-paragraph>
                    <s-button
                      onClick={() => productTypeSuggestionsQuery.refetch()}
                      variant="secondary"
                    >
                      Retry suggestions
                    </s-button>
                  </s-banner>
                ) : null}
              </>
            ) : (
              <s-text-field
                disabled={activeJobInProgress || bulkEditMutation.isPending}
                label="Custom label value"
                maxLength={bulkEditMaxLength}
                name="bulkEditValue"
                onInput={(event) => {
                  setBulkEditValue(event.currentTarget.value);
                  setBulkEditError(null);
                }}
                placeholder="Enter a value"
                value={bulkEditValue}
              />
            )}
            <s-banner
              heading={`Empty values clear ${bulkEditField}`}
              tone="warning"
            >
              <s-paragraph>
                {bulkEditTarget.kind === "customLabel"
                  ? "Leaving this field blank and clicking Apply in bulk will clear this custom label from all variants of the selected products."
                  : "Leaving this field blank and clicking Apply in bulk will erase the currently assigned product type from all selected products."}
              </s-paragraph>
            </s-banner>
            <s-paragraph color="subdued">
              This change will be applied to {formatCount(selectedProductCount)}{" "}
              selected product{selectedProductCount === 1 ? "" : "s"}
              {bulkEditTarget.kind === "productType"
                ? " in Shopify."
                : " and included in the next generated feeds."}
            </s-paragraph>
          </div>
        </s-box>
        <s-button
          disabled={activeJobInProgress || bulkEditMutation.isPending}
          loading={bulkEditMutation.isPending ? true : undefined}
          onClick={applyBulkEdit}
          slot="primary-action"
          variant="primary"
        >
          Apply in bulk
        </s-button>
        <s-button
          command="--hide"
          commandFor={BULK_EDIT_MODAL_ID}
          disabled={activeJobInProgress || bulkEditMutation.isPending}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        accessibilityLabel={`Confirm clearing ${bulkEditField}`}
        heading={`Clear ${bulkEditField}?`}
        id={CLEAR_BULK_EDIT_MODAL_ID}
        padding="none"
        ref={clearBulkEditModalRef}
        size="base"
      >
        <s-box padding="base">
          <div className={styles.productTypeModalContent}>
            {bulkEditError ? (
              <s-banner
                heading="The bulk edit could not be started"
                tone="critical"
              >
                <s-paragraph>{bulkEditError}</s-paragraph>
              </s-banner>
            ) : null}
            <s-banner heading="This removes existing data" tone="warning">
              <s-paragraph>
                This will clear the assigned {bulkEditField} from all{" "}
                {formatCount(selectedProductCount)} selected product
                {selectedProductCount === 1 ? "" : "s"}.
              </s-paragraph>
            </s-banner>
          </div>
        </s-box>
        <s-button
          disabled={activeJobInProgress || bulkEditMutation.isPending}
          loading={bulkEditMutation.isPending ? true : undefined}
          onClick={submitBulkEdit}
          slot="primary-action"
          tone="critical"
          variant="primary"
        >
          Clear {bulkEditField}
        </s-button>
        <s-button
          disabled={activeJobInProgress || bulkEditMutation.isPending}
          onClick={cancelBulkEditClear}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}
