import { useEffect, useMemo, useRef, useState } from "react";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PiEye } from "react-icons/pi";

import { AttributeRulesCard } from "./AttributeRulesCard";
import {
  TabAlertNavigator,
  type TabAlert,
} from "./TabAlertNavigator";
import { useHydrated } from "../hooks/useHydrated";
import type { PublicConfiguration } from "../services/configuration.server";
import {
  collectionsQueryOptions,
  configurationQueryOptions,
  ConfigurationRequestError,
  saveConfigurationRequest,
  shopifyLocationsQueryOptions,
  type ConfigurationQueryScope,
  variantOptionNamesQueryOptions,
} from "../services/configuration-query";
import {
  availableOptionNames,
  ConfigurationValidationError,
  normalizeConfigurationText,
  normalizeExcludedTitleTerms,
  normalizeOptionNames,
  type ConfigurationFieldErrors,
  type ConfigurationInput,
  type SelectedCollection,
  validateConfigurationInput,
} from "../services/configuration-validation";
import styles from "../styles/configurations.module.css";

interface ConfigurationsPanelProps {
  active: boolean;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
  scope: ConfigurationQueryScope | null;
}

const checkoutLinkModeOptions: ReadonlyArray<{
  label: string;
  value: ConfigurationInput["checkoutLinkMode"];
}> = [
  { label: "Disabled", value: "DISABLED" },
  { label: "Link to cart", value: "CART" },
  { label: "Link to checkout", value: "CHECKOUT" },
];

function configurationForm(
  configuration: PublicConfiguration,
): ConfigurationInput {
  return {
    alertsEmail: configuration.alertsEmail,
    countryCode: configuration.countryCode,
    colorOptions: configuration.colorOptions,
    sizeOptions: configuration.sizeOptions,
    excludedCollections: configuration.excludedCollections,
    excludedTitleTerms: configuration.excludedTitleTerms,
    showSalePriceInGoogleFeed: configuration.showSalePriceInGoogleFeed,
    useProductImageAsMainImage: configuration.useProductImageAsMainImage,
    includeShippingWeightInGoogleFeed:
      configuration.includeShippingWeightInGoogleFeed,
    excludeOutOfStockItems: configuration.excludeOutOfStockItems,
    ignoreShopifyInventoryInGoogleFeed:
      configuration.ignoreShopifyInventoryInGoogleFeed,
    inventorySourceMode: configuration.inventorySourceMode,
    selectedInventoryLocationIds:
      configuration.selectedInventoryLocationIds,
    disableUtmParameters: configuration.disableUtmParameters,
    disablePrimaryCurrencyParameter:
      configuration.disablePrimaryCurrencyParameter,
    checkoutLinkMode: configuration.checkoutLinkMode,
  };
}

function configurationFingerprint(configuration: ConfigurationInput) {
  return JSON.stringify(configuration);
}

function ConfigurationSkeleton() {
  return (
    <div
      aria-label="Loading configuration"
      className={styles.skeleton}
      role="status"
    >
      <span className={styles.skeletonLabel} />
      <span className={styles.skeletonInput} />
    </div>
  );
}

function FeatureHeading({
  subtitle,
  title,
  viewAccessibilityLabel,
  viewDisabled,
  viewTarget,
}: {
  subtitle: string;
  title: string;
  viewAccessibilityLabel: string;
  viewDisabled?: boolean;
  viewTarget: string;
}) {
  return (
    <div className={styles.featureHeadingRow}>
      <div className={styles.featureHeading}>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <s-button
        accessibilityLabel={viewAccessibilityLabel}
        command="--show"
        commandFor={viewTarget}
        disabled={viewDisabled ? true : undefined}
        variant="secondary"
      >
        <PiEye aria-hidden="true" focusable="false" size={17} />
      </s-button>
    </div>
  );
}

function optionNameModalId(attribute: "Color" | "Size") {
  return `configuration-${attribute.toLocaleLowerCase()}-option-names`;
}

function OptionNameSelector({
  attribute,
  error,
  onChange,
  placeholder,
  scope,
  unavailableOptions,
  value,
}: {
  attribute: "Color" | "Size";
  error?: string;
  onChange: (value: string[]) => void;
  placeholder: string;
  scope: ConfigurationQueryScope;
  unavailableOptions: string[];
  value: string[];
}) {
  const hydrated = useHydrated();
  const modalId = optionNameModalId(attribute);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draftValue, setDraftValue] = useState<string[]>(value);
  const optionNamesQuery = useQuery({
    ...variantOptionNamesQueryOptions(scope),
    enabled: isOpen,
  });
  const normalizedSearch =
    normalizeConfigurationText(search).toLocaleLowerCase();
  const availableOptions = useMemo(
    () =>
      availableOptionNames(
        optionNamesQuery.data ?? [],
        draftValue,
        unavailableOptions,
      ),
    [draftValue, optionNamesQuery.data, unavailableOptions],
  );
  const visibleOptions = availableOptions.filter((option) =>
    normalizeConfigurationText(option)
      .toLocaleLowerCase()
      .includes(normalizedSearch),
  );
  const selectedOptions = useMemo(
    () =>
      new Set(
        draftValue.map((option) =>
          normalizeConfigurationText(option).toLocaleLowerCase(),
        ),
      ),
    [draftValue],
  );

  const toggleOption = (option: string, checked: boolean) => {
    const comparable = normalizeConfigurationText(option).toLocaleLowerCase();

    setDraftValue((current) =>
      checked
        ? normalizeOptionNames([...current, option])
        : current.filter(
            (value) =>
              normalizeConfigurationText(value).toLocaleLowerCase() !==
              comparable,
          ),
    );
  };

  return (
    <div className={styles.optionField}>
      <s-clickable
        accessibilityLabel={`Select ${attribute} option names`}
        background="base"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={modalId}
        inlineSize="100%"
        padding="small-200 base"
      >
        <s-stack
          alignItems="center"
          direction="inline"
          gap="small"
          justifyContent="space-between"
        >
          <s-text color={value.length > 0 ? "base" : "subdued"}>
            {value.length > 0
              ? `${value.length} option name${value.length === 1 ? "" : "s"} selected`
              : placeholder}
          </s-text>
          <s-icon color="subdued" type="select" />
        </s-stack>
      </s-clickable>

      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}

      <s-modal
        accessibilityLabel={`${attribute} option selection`}
        heading={`${attribute} options`}
        id={modalId}
        onHide={hydrated ? () => setIsOpen(false) : undefined}
        onShow={
          hydrated
            ? () => {
                setDraftValue(value);
                setSearch("");
                setIsOpen(true);
              }
            : undefined
        }
        padding="none"
        size="base"
      >
        <s-box padding="base">
          <div className={styles.optionModalContent}>
            <s-paragraph color="subdued">
              Select the Shopify variant option names that should be treated as{" "}
              {attribute}.
            </s-paragraph>
            {draftValue.length > 0 ? (
              <div
                aria-label={`Selected ${attribute} option names`}
                className={styles.dialogTags}
              >
                {draftValue.map((option) => (
                  <s-clickable-chip
                    accessibilityLabel={`${option}, selected ${attribute} option`}
                    key={normalizeConfigurationText(option).toLocaleLowerCase()}
                    onRemove={
                      hydrated ? () => toggleOption(option, false) : undefined
                    }
                    removable
                  >
                    {option}
                  </s-clickable-chip>
                ))}
              </div>
            ) : (
              <s-text color="subdued">No selections</s-text>
            )}
            <div className={styles.optionModalToolbar}>
              <s-search-field
                label={`Search ${attribute} option names`}
                labelAccessibilityVisibility="exclusive"
                onInput={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search variant option names"
                value={search}
              />
              <s-badge tone="info">{draftValue.length} selected</s-badge>
            </div>

            <div className={styles.optionList}>
              {optionNamesQuery.isPending ? (
                <div className={styles.collectionState}>
                  <s-spinner
                    accessibilityLabel="Loading variant option names"
                    size="base"
                  />
                </div>
              ) : optionNamesQuery.isError ? (
                <div className={styles.collectionState}>
                  <s-text color="subdued">
                    Variant option names could not be loaded.
                  </s-text>
                  <s-button
                    onClick={() => optionNamesQuery.refetch()}
                    variant="secondary"
                  >
                    Retry
                  </s-button>
                </div>
              ) : visibleOptions.length === 0 ? (
                <div className={styles.collectionState}>
                  <s-text color="subdued">No option names found.</s-text>
                </div>
              ) : (
                visibleOptions.map((option) => {
                  const comparable =
                    normalizeConfigurationText(option).toLocaleLowerCase();

                  return (
                    <div className={styles.optionListItem} key={comparable}>
                      <s-checkbox
                        checked={selectedOptions.has(comparable)}
                        label={option}
                        onChange={(event) =>
                          toggleOption(option, event.currentTarget.checked)
                        }
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </s-box>
        <s-button
          command="--hide"
          commandFor={modalId}
          onClick={() => onChange(normalizeOptionNames(draftValue))}
          slot="primary-action"
          variant="primary"
        >
          Confirm
        </s-button>
        <s-button
          command="--hide"
          commandFor={modalId}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}

const COLLECTIONS_MODAL_ID = "configuration-excluded-collections";
const TITLE_TERMS_MODAL_ID = "configuration-excluded-product-titles";

function CollectionSelector({
  error,
  onChange,
  scope,
  value,
}: {
  error?: string;
  onChange: (value: SelectedCollection[]) => void;
  scope: ConfigurationQueryScope;
  value: SelectedCollection[];
}) {
  const hydrated = useHydrated();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [results, setResults] = useState<SelectedCollection[]>([]);
  const [draftValue, setDraftValue] = useState<SelectedCollection[]>(value);
  const searchRef = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const collectionsQuery = useQuery({
    ...collectionsQueryOptions(scope, debouncedSearch, cursor),
    enabled: isOpen,
  });

  useEffect(() => {
    const normalizedSearch = normalizeConfigurationText(search);
    if (!normalizedSearch) {
      setDebouncedSearch("");
      return;
    }

    const timer = window.setTimeout(
      () => setDebouncedSearch(normalizedSearch),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCursor(null);
    setResults([]);
  }, [debouncedSearch]);

  useEffect(() => {
    const page = collectionsQuery.data;
    if (
      !page ||
      normalizeConfigurationText(page.search) !==
        normalizeConfigurationText(debouncedSearch)
    ) {
      return;
    }

    setResults((current) => {
      const next = cursor ? [...current] : [];
      const seen = new Set(next.map((collection) => collection.id));
      for (const collection of page.collections) {
        if (!seen.has(collection.id)) {
          seen.add(collection.id);
          next.push(collection);
        }
      }
      return next;
    });
  }, [collectionsQuery.data, cursor, debouncedSearch]);

  const visibleCollections = results.filter(
    (collection) =>
      !draftValue.some((selected) => selected.id === collection.id),
  );

  return (
    <div className={styles.combobox}>
      <s-clickable
        accessibilityLabel="Edit excluded collections"
        background="base"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={COLLECTIONS_MODAL_ID}
        inlineSize="100%"
        padding="small-200 base"
      >
        <s-stack
          alignItems="center"
          direction="inline"
          gap="small"
          justifyContent="space-between"
        >
          <s-text color={value.length > 0 ? "base" : "subdued"}>
            {value.length > 0
              ? `${value.length} collection${value.length === 1 ? "" : "s"} selected`
              : "Type to search collection"}
          </s-text>
          <s-icon color="subdued" type="select" />
        </s-stack>
      </s-clickable>

      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}

      <s-modal
        accessibilityLabel="Excluded collection selection"
        heading="Excluded collections"
        id={COLLECTIONS_MODAL_ID}
        onHide={hydrated ? () => setIsOpen(false) : undefined}
        onShow={
          hydrated
            ? () => {
                setDraftValue(value);
                setSearch("");
                setDebouncedSearch("");
                setCursor(null);
                setResults([]);
                setIsOpen(true);
                window.requestAnimationFrame(() => searchRef.current?.focus());
              }
            : undefined
        }
        padding="none"
        size="base"
      >
        <s-box padding="base">
          <div className={styles.collectionModalContent}>
            {draftValue.length > 0 ? (
              <div
                aria-label="Selected excluded collections"
                className={styles.dialogTags}
              >
                {draftValue.map((collection) => (
                  <s-clickable-chip
                    accessibilityLabel={`${collection.title}, excluded collection`}
                    key={collection.id}
                    onRemove={
                      hydrated
                        ? () =>
                            setDraftValue((current) =>
                              current.filter(
                                (candidate) => candidate.id !== collection.id,
                              ),
                            )
                        : undefined
                    }
                    removable
                  >
                    {collection.title}
                  </s-clickable-chip>
                ))}
              </div>
            ) : (
              <s-text color="subdued">No collections selected</s-text>
            )}

            <s-search-field
              label="Search store collections"
              labelAccessibilityVisibility="exclusive"
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder="Type to search collection"
              ref={searchRef}
              value={search}
            />

            <div className={styles.popoverResults}>
              {collectionsQuery.isPending && results.length === 0 ? (
                <div className={styles.collectionState}>
                  <s-spinner
                    accessibilityLabel="Loading collections"
                    size="base"
                  />
                </div>
              ) : collectionsQuery.isError ? (
                <div className={styles.collectionState}>
                  <s-text color="subdued">
                    Collections could not be loaded.
                  </s-text>
                  <s-button
                    onClick={() => collectionsQuery.refetch()}
                    variant="secondary"
                  >
                    Retry
                  </s-button>
                </div>
              ) : visibleCollections.length === 0 ? (
                <div className={styles.collectionState}>
                  <s-text color="subdued">No collections found.</s-text>
                </div>
              ) : (
                <s-stack direction="block" gap="small-100">
                  {visibleCollections.map((collection) => (
                    <s-button
                      icon="collection"
                      key={collection.id}
                      onClick={() =>
                        setDraftValue((current) => [...current, collection])
                      }
                      variant="tertiary"
                    >
                      {collection.title}
                    </s-button>
                  ))}
                </s-stack>
              )}
            </div>

            {collectionsQuery.data?.pageInfo.hasNextPage ? (
              <s-button
                disabled={collectionsQuery.isFetching}
                loading={collectionsQuery.isFetching ? true : undefined}
                onClick={() =>
                  setCursor(collectionsQuery.data?.pageInfo.endCursor ?? null)
                }
                variant="secondary"
              >
                Load more
              </s-button>
            ) : null}
          </div>
        </s-box>
        <s-button
          command="--hide"
          commandFor={COLLECTIONS_MODAL_ID}
          onClick={() => onChange(draftValue)}
          slot="primary-action"
          variant="primary"
        >
          Confirm
        </s-button>
        <s-button
          command="--hide"
          commandFor={COLLECTIONS_MODAL_ID}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}

function TitleTermsSelector({
  error,
  onChange,
  value,
}: {
  error?: string;
  onChange: (value: string[]) => void;
  value: string[];
}) {
  const hydrated = useHydrated();
  const [draftValue, setDraftValue] = useState<string[]>(value);
  const [term, setTerm] = useState("");
  const [termError, setTermError] = useState<string | undefined>();

  const addTerm = () => {
    const normalizedTerm = normalizeConfigurationText(term);
    if (!normalizedTerm) {
      setTermError("Enter a word or phrase before adding it.");
      return;
    }

    const next = normalizeExcludedTitleTerms([...draftValue, term]);
    setDraftValue(next);
    setTerm("");
    setTermError(undefined);
  };

  return (
    <div className={styles.optionField}>
      <s-clickable
        accessibilityLabel="Edit excluded product titles"
        background="base"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={TITLE_TERMS_MODAL_ID}
        inlineSize="100%"
        padding="small-200 base"
      >
        <s-stack
          alignItems="center"
          direction="inline"
          gap="small"
          justifyContent="space-between"
        >
          <s-text color={value.length > 0 ? "base" : "subdued"}>
            {value.length > 0
              ? `${value.length} title term${value.length === 1 ? "" : "s"} selected`
              : "Type a product title and press Enter"}
          </s-text>
          <s-icon color="subdued" type="select" />
        </s-stack>
      </s-clickable>

      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}

      <s-modal
        accessibilityLabel="Excluded product title selection"
        heading="Excluded product titles"
        id={TITLE_TERMS_MODAL_ID}
        onShow={
          hydrated
            ? () => {
                setDraftValue(value);
                setTerm("");
                setTermError(undefined);
              }
            : undefined
        }
        padding="none"
        size="base"
      >
        <s-box padding="base">
          <div className={styles.titleTermsModalContent}>
            {draftValue.length > 0 ? (
              <div
                aria-label="Selected excluded product titles"
                className={styles.dialogTags}
              >
                {draftValue.map((titleTerm) => (
                  <s-clickable-chip
                    accessibilityLabel={`${titleTerm}, excluded product title`}
                    key={titleTerm.toLocaleLowerCase()}
                    onRemove={
                      hydrated
                        ? () =>
                            setDraftValue((current) =>
                              current.filter(
                                (candidate) => candidate !== titleTerm,
                              ),
                            )
                        : undefined
                    }
                    removable
                  >
                    {titleTerm}
                  </s-clickable-chip>
                ))}
              </div>
            ) : (
              <s-text color="subdued">No title terms selected</s-text>
            )}

            <form
              className={styles.termInput}
              onSubmit={(event) => {
                event.preventDefault();
                addTerm();
              }}
            >
              <s-text-field
                error={termError}
                label="Product titles"
                labelAccessibilityVisibility="exclusive"
                maxLength={100}
                name="excludedTitleTermDraft"
                onInput={(event) => {
                  setTerm(event.currentTarget.value);
                  setTermError(undefined);
                }}
                placeholder="Type a product title and press Enter"
                value={term}
              />
              <s-button onClick={addTerm} variant="secondary">
                Add
              </s-button>
            </form>
          </div>
        </s-box>
        <s-button
          command="--hide"
          commandFor={TITLE_TERMS_MODAL_ID}
          onClick={() => onChange(normalizeExcludedTitleTerms(draftValue))}
          slot="primary-action"
          variant="primary"
        >
          Confirm
        </s-button>
        <s-button
          command="--hide"
          commandFor={TITLE_TERMS_MODAL_ID}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}

export function ConfigurationsPanel({
  active,
  onUnsavedChangesChange,
  scope,
}: ConfigurationsPanelProps) {
  const isHydrated = useHydrated();
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const queryScope = scope ?? {
    shop: "pending-shop",
    sessionId: "pending-session",
  };
  const [form, setForm] = useState<ConfigurationInput | null>(null);
  const [savedForm, setSavedForm] = useState<ConfigurationInput | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ConfigurationFieldErrors>({});
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "critical";
  } | null>(null);
  const configurationQuery = useQuery({
    ...configurationQueryOptions(queryScope),
    enabled: Boolean(scope) && active,
  });
  const locationsQuery = useQuery({
    ...shopifyLocationsQueryOptions(queryScope),
    enabled:
      Boolean(scope) &&
      active &&
      form?.inventorySourceMode === "SELECTED_LOCATIONS",
  });
  const saveMutation = useMutation({
    mutationFn: (value: ConfigurationInput) => saveConfigurationRequest(value),
  });

  useEffect(() => {
    if (!form && !savedForm && configurationQuery.data?.configuration) {
      const initialForm = configurationForm(
        configurationQuery.data.configuration,
      );
      setForm(initialForm);
      setSavedForm(initialForm);
    }
  }, [configurationQuery.data, form, savedForm]);

  const updateForm = <TKey extends keyof ConfigurationInput>(
    key: TKey,
    value: ConfigurationInput[TKey],
  ) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setFeedback(null);
  };

  const save = async () => {
    if (!scope || !form || isSaving || saveMutation.isPending) {
      return;
    }

    setIsSaving(true);
    let validated: ConfigurationInput;
    try {
      validated = validateConfigurationInput(form);
      setFieldErrors({});
    } catch (error) {
      if (error instanceof ConfigurationValidationError) {
        setFieldErrors(error.fields);
        setFeedback({ message: error.message, tone: "critical" });
        shopify.toast.show(error.message, { isError: true });
      }
      setIsSaving(false);
      return;
    }

    try {
      setFeedback(null);
      const result = await saveMutation.mutateAsync(validated);
      const configuration = result.configuration;
      const nextForm = configurationForm(configuration);
      setForm(nextForm);
      setSavedForm(nextForm);
      queryClient.setQueryData(
        configurationQueryOptions(scope).queryKey,
        (current: typeof configurationQuery.data) =>
          current ? { ...current, configuration } : current,
      );

      if (result.feedRefreshRequired) {
        void queryClient.invalidateQueries({
          queryKey: ["feeds", scope.shop, scope.sessionId],
        });
        shopify.toast.show(
          "Configuration saved. Refresh the XML feed to apply the feed settings.",
        );
      } else {
        shopify.toast.show("Configuration saved successfully.");
      }
    } catch (error) {
      if (error instanceof ConfigurationRequestError) {
        setFieldErrors(error.fields ?? {});
        setFeedback({ message: error.message, tone: "critical" });
        shopify.toast.show(error.message, { isError: true });
      } else {
        const message = "Configuration couldn't be saved. Try again.";
        setFeedback({
          message,
          tone: "critical",
        });
        shopify.toast.show(message, { isError: true });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    if (!savedForm || isSaving || saveMutation.isPending) return;
    setForm(savedForm);
    setFieldErrors({});
    setFeedback(null);
  };

  const isLoading = !form && configurationQuery.isPending;
  const hasUnsavedChanges =
    form !== null &&
    savedForm !== null &&
    configurationFingerprint(form) !== configurationFingerprint(savedForm);
  const saveInProgress = isSaving || saveMutation.isPending;
  const availableLocationIds = useMemo(
    () => new Set((locationsQuery.data ?? []).map(({ id }) => id)),
    [locationsQuery.data],
  );
  const unavailableSelectedLocationIds = useMemo(
    () =>
      (form?.selectedInventoryLocationIds ?? []).filter(
        (id) => !availableLocationIds.has(id),
      ),
    [availableLocationIds, form?.selectedInventoryLocationIds],
  );

  const setInventoryLocationSelected = (id: string, selected: boolean) => {
    const current = form?.selectedInventoryLocationIds ?? [];
    updateForm(
      "selectedInventoryLocationIds",
      selected
        ? [...new Set([...current, id])]
        : current.filter((candidate) => candidate !== id),
    );
  };

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(
    () => () => {
      onUnsavedChangesChange?.(false);
    },
    [onUnsavedChangesChange],
  );

  const tabAlerts: TabAlert[] = [];
  if (configurationQuery.isError) {
    tabAlerts.push({
      actionLabel: "Retry",
      actionLoading: configurationQuery.isFetching,
      heading: "Configuration is unavailable",
      id: "configuration-load",
      message: configurationQuery.error.message,
      onAction: () => void configurationQuery.refetch(),
      tone: "critical",
    });
  }
  if (feedback) {
    tabAlerts.push({
      heading: feedback.message,
      id: "configuration-feedback",
      tone: feedback.tone,
    });
  }

  return (
    <div className={styles.configurations}>
      {isHydrated ? (
        <SaveBar
          id="configuration-contextual-save-bar"
          open={hasUnsavedChanges}
        >
          <button
            disabled={!form || saveInProgress}
            loading={saveInProgress ? "" : undefined}
            onClick={save}
            variant="primary"
          >
            Save
          </button>
          <button
            disabled={saveInProgress}
            onClick={discard}
          >
            Discard
          </button>
        </SaveBar>
      ) : null}

      <div className={styles.header}>
        <div>
          <s-heading>Configurations</s-heading>
          <s-paragraph color="subdued">
            Manage store information, product attributes, and Diagnostics
            exclusions.
          </s-paragraph>
        </div>
      </div>

      <TabAlertNavigator alerts={tabAlerts} />

      <div className={styles.cards}>
        <s-section heading="Information">
          <div className={styles.informationGrid}>
            {isLoading ? (
              <>
                <ConfigurationSkeleton />
                <ConfigurationSkeleton />
              </>
            ) : (
              <>
                <s-text-field
                  autocomplete="on"
                  error={fieldErrors.alertsEmail}
                  label="Alerts email"
                  name="alertsEmail"
                  onInput={(event) =>
                    updateForm("alertsEmail", event.currentTarget.value)
                  }
                  placeholder="store@example.com"
                  value={form?.alertsEmail ?? ""}
                />
                <s-text-field
                  error={fieldErrors.countryCode}
                  label="Country Code"
                  maxLength={2}
                  name="countryCode"
                  onInput={(event) =>
                    updateForm(
                      "countryCode",
                      event.currentTarget.value.toUpperCase(),
                    )
                  }
                  placeholder="US"
                  value={form?.countryCode ?? ""}
                />
              </>
            )}
          </div>
        </s-section>

        <s-section heading="Attributes and Exclusions">
          <div className={styles.features}>
            <div className={styles.feature}>
              <FeatureHeading
                subtitle="Select color option"
                title="Color option"
                viewAccessibilityLabel="View and edit Color options"
                viewDisabled={isLoading}
                viewTarget={optionNameModalId("Color")}
              />
              {isLoading ? (
                <ConfigurationSkeleton />
              ) : (
                <OptionNameSelector
                  attribute="Color"
                  error={fieldErrors.colorOptions}
                  onChange={(value) => updateForm("colorOptions", value)}
                  placeholder="Choose color"
                  scope={queryScope}
                  unavailableOptions={form?.sizeOptions ?? []}
                  value={form?.colorOptions ?? []}
                />
              )}
            </div>

            <div className={styles.feature}>
              <FeatureHeading
                subtitle="Select size option"
                title="Size option"
                viewAccessibilityLabel="View and edit Size options"
                viewDisabled={isLoading}
                viewTarget={optionNameModalId("Size")}
              />
              {isLoading ? (
                <ConfigurationSkeleton />
              ) : (
                <OptionNameSelector
                  attribute="Size"
                  error={fieldErrors.sizeOptions}
                  onChange={(value) => updateForm("sizeOptions", value)}
                  placeholder="Choose size"
                  scope={queryScope}
                  unavailableOptions={form?.colorOptions ?? []}
                  value={form?.sizeOptions ?? []}
                />
              )}
            </div>

            <div className={styles.feature}>
              <FeatureHeading
                subtitle="Collections"
                title="Exclude collection"
                viewAccessibilityLabel="View and edit excluded collections"
                viewDisabled={isLoading}
                viewTarget={COLLECTIONS_MODAL_ID}
              />
              {isLoading ? (
                <ConfigurationSkeleton />
              ) : (
                <CollectionSelector
                  error={fieldErrors.excludedCollections}
                  onChange={(value) => updateForm("excludedCollections", value)}
                  scope={queryScope}
                  value={form?.excludedCollections ?? []}
                />
              )}
            </div>

            <div className={styles.feature}>
              <FeatureHeading
                subtitle="Product titles"
                title="Exclude product by title"
                viewAccessibilityLabel="View and edit excluded product titles"
                viewDisabled={isLoading}
                viewTarget={TITLE_TERMS_MODAL_ID}
              />
              {isLoading ? (
                <ConfigurationSkeleton />
              ) : (
                <TitleTermsSelector
                  error={fieldErrors.excludedTitleTerms}
                  onChange={(value) => updateForm("excludedTitleTerms", value)}
                  value={form?.excludedTitleTerms ?? []}
                />
              )}
            </div>

            <div className={styles.googleFeedOptions}>
              <div className={styles.googleFeedOptionsHeading}>
                <h3>Google feed options</h3>
                <p>Control optional product data in generated XML feeds.</p>
              </div>
              {isLoading ? (
                <div className={styles.googleFeedOptionsGrid}>
                  <ConfigurationSkeleton />
                  <ConfigurationSkeleton />
                  <ConfigurationSkeleton />
                  <ConfigurationSkeleton />
                </div>
              ) : (
                <div className={styles.googleFeedOptionsGrid}>
                  <s-checkbox
                    checked={form?.showSalePriceInGoogleFeed ?? false}
                    details="When enabled, Google receives the original price plus sale_price. When disabled, only the final current price is sent."
                    error={fieldErrors.showSalePriceInGoogleFeed}
                    label="Show sale price in Google feed"
                    onChange={(event) =>
                      updateForm(
                        "showSalePriceInGoogleFeed",
                        event.currentTarget.checked,
                      )
                    }
                  />
                  <s-checkbox
                    checked={form?.includeShippingWeightInGoogleFeed ?? false}
                    details="When enabled, variants with a valid Shopify weight include shipping_weight in the XML."
                    error={fieldErrors.includeShippingWeightInGoogleFeed}
                    label="Include shipping weight in Google feed"
                    onChange={(event) =>
                      updateForm(
                        "includeShippingWeightInGoogleFeed",
                        event.currentTarget.checked,
                      )
                    }
                  />
                  <s-checkbox
                    checked={form?.useProductImageAsMainImage ?? false}
                    details="The main product image is the image which is usually shown on the category page."
                    error={fieldErrors.useProductImageAsMainImage}
                    label="Use product image as main image"
                    onChange={(event) =>
                      updateForm(
                        "useProductImageAsMainImage",
                        event.currentTarget.checked,
                      )
                    }
                  />
                  <s-checkbox
                    checked={form?.excludeOutOfStockItems ?? false}
                    details="When enabled, out-of-stock variants are excluded. This is ignored when Shopify inventory is not tracked or selling can continue."
                    disabled={
                      form?.ignoreShopifyInventoryInGoogleFeed
                        ? true
                        : undefined
                    }
                    error={fieldErrors.excludeOutOfStockItems}
                    label="Exclude out of stock items"
                    onChange={(event) =>
                      updateForm(
                        "excludeOutOfStockItems",
                        event.currentTarget.checked,
                      )
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </s-section>

        <s-section heading="Inventory & Availability">
          <div className={styles.inventoryAvailability}>
            <s-paragraph color="subdued">
              Control how Shopify inventory becomes Google feed availability.
            </s-paragraph>

            {isLoading ? (
              <>
                <ConfigurationSkeleton />
                <ConfigurationSkeleton />
              </>
            ) : (
              <>
                <s-checkbox
                  checked={
                    form?.ignoreShopifyInventoryInGoogleFeed ?? false
                  }
                  details="When enabled, active products are sent to Google as in stock even if Shopify inventory is 0. Use only if your storefront also remains purchasable."
                  error={
                    fieldErrors.ignoreShopifyInventoryInGoogleFeed
                  }
                  label="Ignore Shopify inventory in Google feed"
                  onChange={(event) =>
                    updateForm(
                      "ignoreShopifyInventoryInGoogleFeed",
                      event.currentTarget.checked,
                    )
                  }
                />

                {form?.ignoreShopifyInventoryInGoogleFeed ? (
                  <s-banner
                    heading="Google may compare feed availability with your website"
                    tone="warning"
                  >
                    Out-of-stock exclusion is ignored while this option is
                    enabled.
                  </s-banner>
                ) : null}

                <div className={styles.inventorySource}>
                  <div className={styles.inventorySourceHeading}>
                    <h3>Inventory source</h3>
                    <p>
                      Choose which Shopify locations are used to calculate
                      variant availability.
                    </p>
                  </div>

                  <s-choice-list
                    error={fieldErrors.inventorySourceMode}
                    label="Inventory source"
                    labelAccessibilityVisibility="exclusive"
                    name="inventory-source-mode"
                    onChange={(event) =>
                      updateForm(
                        "inventorySourceMode",
                        event.currentTarget.values[0] ===
                          "SELECTED_LOCATIONS"
                          ? "SELECTED_LOCATIONS"
                          : "ALL_LOCATIONS",
                      )
                    }
                    values={[
                      form?.inventorySourceMode ?? "ALL_LOCATIONS",
                    ]}
                  >
                    <s-choice value="ALL_LOCATIONS">
                      All Shopify locations
                    </s-choice>
                    <s-choice value="SELECTED_LOCATIONS">
                      Selected locations
                    </s-choice>
                  </s-choice-list>

                  {form?.inventorySourceMode === "SELECTED_LOCATIONS" ? (
                    <div className={styles.inventoryLocations}>
                      <h4>Locations to count</h4>

                      {locationsQuery.isPending ? (
                        <div
                          aria-live="polite"
                          className={styles.inventoryLocationState}
                        >
                          <s-spinner
                            accessibilityLabel="Loading Shopify locations"
                            size="base"
                          />
                          <span>Loading Shopify locations…</span>
                        </div>
                      ) : locationsQuery.isError ? (
                        <div
                          className={styles.inventoryLocationState}
                          role="alert"
                        >
                          <span>Shopify locations couldn&apos;t be loaded.</span>
                          <s-button
                            onClick={() => void locationsQuery.refetch()}
                            variant="secondary"
                          >
                            Retry
                          </s-button>
                        </div>
                      ) : (locationsQuery.data?.length ?? 0) === 0 &&
                        unavailableSelectedLocationIds.length === 0 ? (
                        <div className={styles.inventoryLocationState}>
                          No active Shopify locations are available.
                        </div>
                      ) : (
                        <div className={styles.inventoryLocationList}>
                          {locationsQuery.data?.map((location) => (
                            <s-checkbox
                              checked={
                                form.selectedInventoryLocationIds.includes(
                                  location.id,
                                )
                              }
                              key={location.id}
                              label={location.name}
                              onChange={(event) =>
                                setInventoryLocationSelected(
                                  location.id,
                                  event.currentTarget.checked,
                                )
                              }
                            />
                          ))}

                          {unavailableSelectedLocationIds.map((id) => (
                            <s-checkbox
                              checked
                              details="This saved location is no longer active or accessible. Uncheck it to remove it."
                              key={id}
                              label={`Unavailable location (${id.split("/").at(-1) ?? id})`}
                              onChange={(event) =>
                                setInventoryLocationSelected(
                                  id,
                                  event.currentTarget.checked,
                                )
                              }
                            />
                          ))}
                        </div>
                      )}

                      {fieldErrors.selectedInventoryLocationIds ? (
                        <span className={styles.fieldError} role="alert">
                          {fieldErrors.selectedInventoryLocationIds}
                        </span>
                      ) : null}

                      {form.selectedInventoryLocationIds.length === 0 ? (
                        <s-paragraph color="subdued">
                          If empty, inventory from all locations will be used.
                        </s-paragraph>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </s-section>

        <s-section heading="URL Options">
          <div className={styles.urlOptions}>
            <s-paragraph color="subdued">
              Control tracking, currency, and checkout URLs used in the final
              XML feed.
            </s-paragraph>

            {isLoading ? (
              <>
                <ConfigurationSkeleton />
                <ConfigurationSkeleton />
                <ConfigurationSkeleton />
              </>
            ) : (
              <>
                <s-checkbox
                  checked={form?.disableUtmParameters ?? false}
                  details="By default, links include Google Shopping UTM parameters for analytics tracking."
                  error={fieldErrors.disableUtmParameters}
                  label="Do not add UTM parameters to product links"
                  onChange={(event) =>
                    updateForm(
                      "disableUtmParameters",
                      event.currentTarget.checked,
                    )
                  }
                />

                <s-checkbox
                  checked={form?.disablePrimaryCurrencyParameter ?? false}
                  details="Shopify Market feeds always keep the currency parameter so market pricing keeps working."
                  error={fieldErrors.disablePrimaryCurrencyParameter}
                  label="Do not add currency parameter to main feed product links"
                  onChange={(event) =>
                    updateForm(
                      "disablePrimaryCurrencyParameter",
                      event.currentTarget.checked,
                    )
                  }
                />

                <div className={styles.checkoutLinkSetting}>
                  <span className={styles.checkoutLinkLabel}>
                    Add checkout link URL
                  </span>
                  <s-clickable
                    accessibilityLabel="Choose checkout link URL behavior"
                    background="base"
                    border="small-100"
                    borderColor="base"
                    borderRadius="base"
                    borderStyle="solid"
                    command="--show"
                    commandFor="checkout-link-mode-popover"
                    inlineSize="100%"
                    padding="small-200 base"
                  >
                    <s-stack
                      alignItems="center"
                      direction="inline"
                      gap="small"
                      justifyContent="space-between"
                    >
                      <s-text>
                        {checkoutLinkModeOptions.find(
                          ({ value }) =>
                            value === (form?.checkoutLinkMode ?? "DISABLED"),
                        )?.label ?? "Disabled"}
                      </s-text>
                      <s-icon color="subdued" type="chevron-down" />
                    </s-stack>
                  </s-clickable>

                  {fieldErrors.checkoutLinkMode ? (
                    <span className={styles.fieldError} role="alert">
                      {fieldErrors.checkoutLinkMode}
                    </span>
                  ) : null}

                  <s-popover id="checkout-link-mode-popover" inlineSize="360px">
                    <s-box padding="small-200">
                      <div className={styles.checkoutLinkOptions}>
                        {checkoutLinkModeOptions.map((option) => (
                          <s-button
                            command="--hide"
                            commandFor="checkout-link-mode-popover"
                            key={option.value}
                            onClick={() =>
                              updateForm("checkoutLinkMode", option.value)
                            }
                            variant="tertiary"
                          >
                            <span className={styles.checkoutLinkOptionContent}>
                              <span>{option.label}</span>
                              {option.value ===
                              (form?.checkoutLinkMode ?? "DISABLED") ? (
                                <s-icon type="check" />
                              ) : null}
                            </span>
                          </s-button>
                        ))}
                      </div>
                    </s-box>
                  </s-popover>

                  <p className={styles.checkoutLinkDetails}>
                    This will include a checkout URL in your product data which
                    gives online shoppers the option to go directly to checkout
                    in Free listings. See{" "}
                    <a
                      className={styles.supportLink}
                      href="https://support.google.com/merchants/answer/13580733"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Google Merchant support
                    </a>{" "}
                    and{" "}
                    <a
                      className={styles.supportLink}
                      href="https://help.shopify.com/en/manual/products/details/cart-permalink"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Shopify help
                    </a>
                    .
                  </p>
                </div>
              </>
            )}
          </div>
        </s-section>

        {scope ? (
          <AttributeRulesCard
            configuration={configurationQuery.data?.configuration ?? null}
            initialJobs={configurationQuery.data?.ruleJobs ?? null}
            scope={scope}
          />
        ) : (
          <s-section heading="Gender & Age Rules">
            <ConfigurationSkeleton />
          </s-section>
        )}
      </div>
    </div>
  );
}
