import { useEffect, useMemo, useRef, useState } from "react";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AttributeRulesCard } from "./AttributeRulesCard";
import type { PublicConfiguration } from "../services/configuration.server";
import {
  collectionsQueryOptions,
  configurationQueryOptions,
  ConfigurationRequestError,
  saveConfigurationRequest,
  type ConfigurationQueryScope,
  variantOptionNamesQueryOptions,
} from "../services/configuration-query";
import {
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
}: {
  subtitle: string;
  title: string;
}) {
  return (
    <div className={styles.featureHeading}>
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  );
}

function OptionNameSelector({
  attribute,
  error,
  onChange,
  placeholder,
  scope,
  value,
}: {
  attribute: "Color" | "Size";
  error?: string;
  onChange: (value: string[]) => void;
  placeholder: string;
  scope: ConfigurationQueryScope;
  value: string[];
}) {
  const modalId = `configuration-${attribute.toLocaleLowerCase()}-option-names`;
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
      normalizeOptionNames([...(optionNamesQuery.data ?? []), ...draftValue]),
    [draftValue, optionNamesQuery.data],
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
      <div className={styles.tags}>
        {value.map((option) => (
          <span className={styles.tag} key={option.toLocaleLowerCase()}>
            <span>{option}</span>
            <button
              aria-label={`Remove ${option} from ${attribute}`}
              onClick={() =>
                onChange(
                  value.filter(
                    (current) =>
                      normalizeConfigurationText(
                        current,
                      ).toLocaleLowerCase() !==
                      normalizeConfigurationText(option).toLocaleLowerCase(),
                  ),
                )
              }
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>

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
        heading={`Select ${attribute} option names`}
        id={modalId}
        onHide={() => setIsOpen(false)}
        onShow={() => {
          setDraftValue(value);
          setSearch("");
          setIsOpen(true);
        }}
        padding="none"
        size="base"
      >
        <s-box padding="base">
          <div className={styles.optionModalContent}>
            <s-paragraph color="subdued">
              Select the Shopify variant option names that should be treated as{" "}
              {attribute}.
            </s-paragraph>
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

export function ConfigurationsPanel({
  active,
  onUnsavedChangesChange,
  scope,
}: ConfigurationsPanelProps) {
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
  const [collectionSearch, setCollectionSearch] = useState("");
  const [debouncedCollectionSearch, setDebouncedCollectionSearch] =
    useState("");
  const [collectionCursor, setCollectionCursor] = useState<string | null>(null);
  const [collectionResults, setCollectionResults] = useState<
    SelectedCollection[]
  >([]);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const collectionSearchRef =
    useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const [titleTerm, setTitleTerm] = useState("");
  const configurationQuery = useQuery({
    ...configurationQueryOptions(queryScope),
    enabled: Boolean(scope) && active,
  });
  const collectionsQuery = useQuery({
    ...collectionsQueryOptions(
      queryScope,
      debouncedCollectionSearch,
      collectionCursor,
    ),
    enabled: Boolean(scope) && active && collectionOpen,
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

  useEffect(() => {
    const normalizedSearch = normalizeConfigurationText(collectionSearch);

    if (!normalizedSearch) {
      setDebouncedCollectionSearch("");
      return;
    }

    const timer = window.setTimeout(
      () => setDebouncedCollectionSearch(normalizedSearch),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [collectionSearch]);

  useEffect(() => {
    setCollectionCursor(null);
    setCollectionResults([]);
  }, [debouncedCollectionSearch]);

  useEffect(() => {
    const page = collectionsQuery.data;

    if (
      !page ||
      normalizeConfigurationText(page.search) !==
        normalizeConfigurationText(debouncedCollectionSearch)
    ) {
      return;
    }

    setCollectionResults((current) => {
      const next = collectionCursor ? [...current] : [];
      const seen = new Set(next.map((collection) => collection.id));

      for (const collection of page.collections) {
        if (!seen.has(collection.id)) {
          seen.add(collection.id);
          next.push(collection);
        }
      }

      return next;
    });
  }, [collectionCursor, collectionsQuery.data, debouncedCollectionSearch]);

  const visibleCollections = collectionResults.filter(
    (collection) =>
      !form?.excludedCollections.some(
        (selected) => selected.id === collection.id,
      ),
  );

  const updateForm = <TKey extends keyof ConfigurationInput>(
    key: TKey,
    value: ConfigurationInput[TKey],
  ) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setFeedback(null);
  };

  const selectCollection = (collection: SelectedCollection) => {
    if (!form) {
      return;
    }

    updateForm("excludedCollections", [
      ...form.excludedCollections,
      collection,
    ]);
  };

  const removeCollection = (id: string) => {
    if (form) {
      updateForm(
        "excludedCollections",
        form.excludedCollections.filter((collection) => collection.id !== id),
      );
    }
  };

  const addTitleTerm = () => {
    if (!form) {
      return;
    }

    const nextTerms = normalizeExcludedTitleTerms([
      ...form.excludedTitleTerms,
      titleTerm,
    ]);

    if (nextTerms.length === form.excludedTitleTerms.length) {
      if (!normalizeConfigurationText(titleTerm)) {
        setFieldErrors((current) => ({
          ...current,
          excludedTitleTerms: "Enter a word or phrase before adding it.",
        }));
      }
      return;
    }

    updateForm("excludedTitleTerms", nextTerms);
    setTitleTerm("");
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
    setTitleTerm("");
  };

  const isLoading = !form && configurationQuery.isPending;
  const hasUnsavedChanges =
    form !== null &&
    savedForm !== null &&
    configurationFingerprint(form) !== configurationFingerprint(savedForm);

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(
    () => () => {
      onUnsavedChangesChange?.(false);
    },
    [onUnsavedChangesChange],
  );

  return (
    <div className={styles.configurations}>
      <SaveBar
        discardConfirmation={false}
        id="configuration-contextual-save-bar"
        open={hasUnsavedChanges}
      >
        <button
          disabled={!form || isSaving || saveMutation.isPending}
          loading={isSaving || saveMutation.isPending}
          onClick={save}
          variant="primary"
        >
          {isSaving || saveMutation.isPending ? "Saving…" : "Save"}
        </button>
        <button
          disabled={isSaving || saveMutation.isPending}
          onClick={discard}
        >
          Discard
        </button>
      </SaveBar>

      <div className={styles.header}>
        <div>
          <s-heading>Configurations</s-heading>
          <s-paragraph color="subdued">
            Manage store information, product attributes, and Diagnostics
            exclusions.
          </s-paragraph>
        </div>
      </div>

      {configurationQuery.isError ? (
        <s-banner heading="Configuration is unavailable" tone="critical">
          {configurationQuery.error.message}
          <s-button
            onClick={() => configurationQuery.refetch()}
            slot="secondary-actions"
            variant="secondary"
          >
            Retry
          </s-button>
        </s-banner>
      ) : null}

      {feedback ? (
        <s-banner heading={feedback.message} tone={feedback.tone} />
      ) : null}

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
                  value={form?.colorOptions ?? []}
                />
              )}
            </div>

            <div className={styles.feature}>
              <FeatureHeading
                subtitle="Select size option"
                title="Size option"
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
                  value={form?.sizeOptions ?? []}
                />
              )}
            </div>

            <div className={styles.feature}>
              <FeatureHeading
                subtitle="Collections"
                title="Exclude collection"
              />
              {isLoading ? (
                <ConfigurationSkeleton />
              ) : (
                <>
                  <div className={styles.tags}>
                    {form?.excludedCollections.map((collection) => (
                      <span className={styles.tag} key={collection.id}>
                        <span>{collection.title}</span>
                        <button
                          aria-label={`Remove ${collection.title}`}
                          onClick={() => removeCollection(collection.id)}
                          type="button"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className={styles.combobox}>
                    <s-clickable
                      accessibilityLabel="Search collections to exclude"
                      background="base"
                      border="small-100"
                      borderColor="base"
                      borderRadius="base"
                      borderStyle="solid"
                      commandFor="configuration-collection-popover"
                      inlineSize="100%"
                      padding="small-200 base"
                    >
                      <s-stack
                        alignItems="center"
                        direction="inline"
                        gap="small"
                        justifyContent="space-between"
                      >
                        <s-stack
                          alignItems="center"
                          direction="inline"
                          gap="small"
                        >
                          <s-icon color="subdued" type="search" />
                          <s-text color="subdued">
                            Type to search collection
                          </s-text>
                        </s-stack>
                        <s-icon color="subdued" type="chevron-down" />
                      </s-stack>
                    </s-clickable>

                    {fieldErrors.excludedCollections ? (
                      <span className={styles.fieldError} role="alert">
                        {fieldErrors.excludedCollections}
                      </span>
                    ) : null}

                    <s-popover
                      blockSize="340px"
                      id="configuration-collection-popover"
                      inlineSize="360px"
                      onHide={() => setCollectionOpen(false)}
                      onShow={() => {
                        setCollectionOpen(true);
                        window.requestAnimationFrame(() =>
                          collectionSearchRef.current?.focus(),
                        );
                      }}
                    >
                      <s-box padding="small-200">
                        <div className={styles.configurationPopoverContent}>
                          <s-search-field
                            label="Search store collections"
                            labelAccessibilityVisibility="exclusive"
                            onInput={(event) => {
                              const value = event.currentTarget.value;
                              setCollectionSearch(value);
                              if (!normalizeConfigurationText(value)) {
                                setDebouncedCollectionSearch("");
                              }
                            }}
                            placeholder="Type to search collection"
                            ref={collectionSearchRef}
                            value={collectionSearch}
                          />

                          <div className={styles.popoverResults}>
                            {collectionsQuery.isPending &&
                            collectionResults.length === 0 ? (
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
                                <s-text color="subdued">
                                  No collections found.
                                </s-text>
                              </div>
                            ) : (
                              <s-stack direction="block" gap="small-100">
                                {visibleCollections.map((collection) => (
                                  <s-button
                                    icon="collection"
                                    key={collection.id}
                                    onClick={() => selectCollection(collection)}
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
                              loading={
                                collectionsQuery.isFetching ? true : undefined
                              }
                              onClick={() =>
                                setCollectionCursor(
                                  collectionsQuery.data?.pageInfo.endCursor ??
                                    null,
                                )
                              }
                              variant="secondary"
                            >
                              Load more
                            </s-button>
                          ) : null}
                        </div>
                      </s-box>
                    </s-popover>
                  </div>
                </>
              )}
            </div>

            <div className={styles.feature}>
              <FeatureHeading
                subtitle="Product titles"
                title="Exclude product by title"
              />
              {isLoading ? (
                <ConfigurationSkeleton />
              ) : (
                <>
                  <div className={styles.tags}>
                    {form?.excludedTitleTerms.map((term) => (
                      <span
                        className={styles.tag}
                        key={term.toLocaleLowerCase()}
                      >
                        <span>{term}</span>
                        <button
                          aria-label={`Remove ${term}`}
                          onClick={() =>
                            updateForm(
                              "excludedTitleTerms",
                              form.excludedTitleTerms.filter(
                                (current) => current !== term,
                              ),
                            )
                          }
                          type="button"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <form
                    className={styles.termInput}
                    onSubmit={(event) => {
                      event.preventDefault();
                      addTitleTerm();
                    }}
                  >
                    <s-text-field
                      error={fieldErrors.excludedTitleTerms}
                      label="Product titles"
                      labelAccessibilityVisibility="exclusive"
                      maxLength={100}
                      name="excludedTitleTerm"
                      onInput={(event) => {
                        setTitleTerm(event.currentTarget.value);
                        setFieldErrors((current) => ({
                          ...current,
                          excludedTitleTerms: undefined,
                        }));
                      }}
                      placeholder="Type a product title and press Enter"
                      value={titleTerm}
                    />
                    <s-button onClick={addTitleTerm} variant="secondary">
                      Add
                    </s-button>
                  </form>
                </>
              )}
            </div>

            <div className={`${styles.feature} ${styles.pricingFeature}`}>
              {isLoading ? (
                <ConfigurationSkeleton />
              ) : (
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
              )}
            </div>
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
                  checked={
                    form?.disablePrimaryCurrencyParameter ?? false
                  }
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
                  <s-select
                    details="This will include a checkout URL in your product data which gives online shoppers the option to go directly to checkout in Free Listings."
                    error={fieldErrors.checkoutLinkMode}
                    label="Add checkout link URL"
                    onChange={(event) =>
                      updateForm(
                        "checkoutLinkMode",
                        event.currentTarget.value as
                          | "DISABLED"
                          | "CART"
                          | "CHECKOUT",
                      )
                    }
                    value={form?.checkoutLinkMode ?? "DISABLED"}
                  >
                    <s-option value="DISABLED">Disabled</s-option>
                    <s-option value="CART">Link to cart</s-option>
                    <s-option value="CHECKOUT">Link to checkout</s-option>
                  </s-select>

                  <s-stack direction="inline" gap="base">
                    <s-link
                      href="https://support.google.com/merchants/answer/13580733"
                      target="_blank"
                    >
                      Google Merchant support
                    </s-link>
                    <s-link
                      href="https://help.shopify.com/en/manual/checkout-settings/cart-permalink"
                      target="_blank"
                    >
                      Shopify help
                    </s-link>
                  </s-stack>
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
