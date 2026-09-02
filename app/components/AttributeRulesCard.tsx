import { useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  PublicAttributeRuleJob,
  PublicAttributeRuleJobs,
  PublicConfiguration,
} from "../services/configuration.server";
import {
  AttributeRulesValidationError,
  AGE_RULE_OPTIONS,
  GENDER_RULE_OPTIONS,
  validateAgeRules,
  validateGenderRules,
  type AgeRulesConfiguration,
  type AttributeRuleKind,
  type GenderRulesConfiguration,
} from "../services/attribute-rules";
import {
  attributeRuleStatusQueryOptions,
  collectionsQueryOptions,
  configurationQueryOptions,
  retryAttributeRulesRequest,
  saveAttributeRulesRequest,
  type ConfigurationQueryScope,
} from "../services/configuration-query";
import {
  normalizeConfigurationText,
  type SelectedCollection,
} from "../services/configuration-validation";
import {
  diagnosticsKeys,
  type DiagnosticsQueryScope,
} from "../services/diagnostics-query";
import { useHydrated } from "../hooks/useHydrated";
import styles from "../styles/configurations.module.css";

interface AttributeRulesCardProps {
  configuration: PublicConfiguration | null;
  initialJobs: PublicAttributeRuleJobs | null;
  scope: ConfigurationQueryScope;
}

interface EditorRule {
  collections: SelectedCollection[];
  id: string;
  value: string;
}

interface EditorDraft {
  defaultValue: string;
  rules: EditorRule[];
}

interface RuleValueOption {
  label: string;
  value: string;
}

function RuleValuePicker({
  emptyLabel,
  id,
  label,
  onChange,
  options,
  value,
}: {
  emptyLabel: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly RuleValueOption[];
  value: string;
}) {
  const popoverId = `attribute-rule-value-${id}`;
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? emptyLabel;
  const choices = [{ label: emptyLabel, value: "" }, ...options];

  return (
    <div className={styles.ruleValuePicker}>
      <span className={styles.ruleFieldLabel}>{label}</span>
      <s-clickable
        accessibilityLabel={`Choose ${label}`}
        background="base"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={popoverId}
        inlineSize="100%"
        padding="small-200 base"
      >
        <s-stack
          alignItems="center"
          direction="inline"
          gap="small"
          justifyContent="space-between"
        >
          <s-text color={value ? "base" : "subdued"}>{selectedLabel}</s-text>
          <s-icon color="subdued" type="chevron-down" />
        </s-stack>
      </s-clickable>
      <s-popover blockSize="260px" id={popoverId} inlineSize="360px">
        <s-box padding="small-200">
          <div className={styles.ruleValueOptions}>
            {choices.map((option) => (
              <s-button
                command="--hide"
                commandFor={popoverId}
                icon={option.value === value ? "check" : undefined}
                key={option.value || "none"}
                onClick={() => onChange(option.value)}
                variant="tertiary"
              >
                {option.label}
              </s-button>
            ))}
          </div>
        </s-box>
      </s-popover>
    </div>
  );
}

interface RuleCollectionPickerProps {
  onChange: (collections: SelectedCollection[]) => void;
  ruleId: string;
  scope: ConfigurationQueryScope;
  selected: SelectedCollection[];
  unavailableCollectionIds: ReadonlySet<string>;
}

function RuleCollectionPicker({
  onChange,
  ruleId,
  scope,
  selected,
  unavailableCollectionIds,
}: RuleCollectionPickerProps) {
  const hydrated = useHydrated();
  const popoverId = `attribute-rule-collections-${ruleId}`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [results, setResults] = useState<SelectedCollection[]>([]);
  const searchRef = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const query = useQuery({
    ...collectionsQueryOptions(scope, debouncedSearch, cursor),
    enabled: open,
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

  const selectedIds = new Set(selected.map(({ id }) => id));
  const visible = results.filter(({ id }) => !selectedIds.has(id));

  return (
    <div className={styles.ruleCollectionPicker}>
      <div className={styles.tags}>
        {selected.map((collection) => (
          <span className={styles.tag} key={collection.id}>
            <span>{collection.title}</span>
            <button
              aria-label={`Remove ${collection.title}`}
              onClick={() =>
                onChange(selected.filter(({ id }) => id !== collection.id))
              }
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <s-clickable
        accessibilityLabel="Select collections for this rule"
        background="base"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        commandFor={popoverId}
        inlineSize="100%"
        padding="small-200 base"
      >
        <s-stack
          alignItems="center"
          direction="inline"
          gap="small"
          justifyContent="space-between"
        >
          <s-text color="subdued">Select collections</s-text>
          <s-icon color="subdued" type="chevron-down" />
        </s-stack>
      </s-clickable>
      <s-popover
        blockSize="340px"
        id={popoverId}
        inlineSize="400px"
        onHide={
          hydrated
            ? () => {
                setOpen(false);
                setSearch("");
              }
            : undefined
        }
        onShow={
          hydrated
            ? () => {
                setOpen(true);
                window.requestAnimationFrame(() => searchRef.current?.focus());
              }
            : undefined
        }
      >
        <s-box padding="small-200">
          <div className={styles.configurationPopoverContent}>
            <s-search-field
              label="Search store collections"
              labelAccessibilityVisibility="exclusive"
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search collections"
              ref={searchRef}
              value={search}
            />
            <div className={styles.popoverResults}>
              {query.isPending && results.length === 0 ? (
                <div className={styles.collectionState}>
                  <s-spinner
                    accessibilityLabel="Loading collections"
                    size="base"
                  />
                </div>
              ) : query.isError ? (
                <div className={styles.collectionState}>
                  <s-text color="subdued">
                    Collections could not be loaded.
                  </s-text>
                  <s-button onClick={() => query.refetch()} variant="secondary">
                    Retry
                  </s-button>
                </div>
              ) : visible.length === 0 ? (
                <div className={styles.collectionState}>
                  <s-text color="subdued">
                    No available collections found.
                  </s-text>
                </div>
              ) : (
                <s-stack direction="block" gap="small-100">
                  {visible.map((collection) => (
                    <s-button
                      disabled={
                        unavailableCollectionIds.has(collection.id)
                          ? true
                          : undefined
                      }
                      icon="collection"
                      key={collection.id}
                      onClick={() => {
                        if (!unavailableCollectionIds.has(collection.id)) {
                          onChange([...selected, collection]);
                        }
                      }}
                      variant="tertiary"
                    >
                      {collection.title}
                      {unavailableCollectionIds.has(collection.id)
                        ? " — Used in another rule"
                        : ""}
                    </s-button>
                  ))}
                </s-stack>
              )}
            </div>
            {query.data?.pageInfo.hasNextPage ? (
              <s-button
                disabled={query.isFetching}
                loading={query.isFetching ? true : undefined}
                onClick={() =>
                  setCursor(query.data?.pageInfo.endCursor ?? null)
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
  );
}

function RuleJobStatus({
  job,
  label,
  onRetry,
  retrying,
}: {
  job: PublicAttributeRuleJob | null;
  label: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (!job) {
    return <s-text color="subdued">{label}: Not applied yet</s-text>;
  }
  const progress =
    job.totalProducts !== null
      ? `${job.processedProducts.toLocaleString()} / ${job.totalProducts.toLocaleString()} products`
      : `${job.processedProducts.toLocaleString()} products`;
  const tone =
    job.status === "COMPLETED"
      ? "success"
      : job.status === "FAILED"
        ? "critical"
        : job.status === "QUEUED" || job.status === "PROCESSING"
          ? "info"
          : undefined;

  return (
    <div className={styles.ruleStatus}>
      <s-stack alignItems="center" direction="inline" gap="small">
        {job.status === "QUEUED" || job.status === "PROCESSING" ? (
          <s-spinner
            accessibilityLabel={`Applying ${label} rules`}
            size="base"
          />
        ) : null}
        <s-text>{label}</s-text>
        <s-badge tone={tone}>
          {job.status === "QUEUED"
            ? "Queued"
            : job.status === "PROCESSING"
              ? "Applying rules"
              : job.status.charAt(0) + job.status.slice(1).toLocaleLowerCase()}
        </s-badge>
        {job.status === "PROCESSING" || job.status === "COMPLETED" ? (
          <s-text color="subdued">{progress}</s-text>
        ) : null}
      </s-stack>
      {job.status === "FAILED" && job.lastError ? (
        <>
          <span className={styles.fieldError} role="alert">
            {job.lastError}
          </span>
          <div>
            <s-button
              disabled={retrying}
              loading={retrying ? true : undefined}
              onClick={onRetry}
              variant="secondary"
            >
              Retry
            </s-button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AttributeRulesEditor({
  kind,
  onSaved,
  saved,
  scope,
}: {
  kind: AttributeRuleKind;
  onSaved: (
    kind: AttributeRuleKind,
    configuration: PublicConfiguration,
    jobs: PublicAttributeRuleJobs,
  ) => void;
  saved: EditorDraft;
  scope: ConfigurationQueryScope;
}) {
  const shopify = useAppBridge();
  const modalId = `${kind}-attribute-rules-modal`;
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const nextRuleId = useRef(0);
  const [draft, setDraft] = useState<EditorDraft>(saved);
  const [error, setError] = useState<string | null>(null);
  const options = kind === "gender" ? GENDER_RULE_OPTIONS : AGE_RULE_OPTIONS;
  const title = kind === "gender" ? "Gender Rules" : "Age Rules";
  const defaultTitle =
    kind === "gender" ? "Default Gender" : "Default Age Group";
  const mutation = useMutation({
    mutationFn: (
      configuration: GenderRulesConfiguration | AgeRulesConfiguration,
    ) => saveAttributeRulesRequest(kind, configuration),
  });

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const usedCollectionsByRule = useMemo(
    () =>
      new Map(
        draft.rules.map((rule) => [
          rule.id,
          new Set(
            draft.rules
              .filter(({ id }) => id !== rule.id)
              .flatMap(({ collections }) => collections.map(({ id }) => id)),
          ),
        ]),
      ),
    [draft.rules],
  );

  const updateRule = (ruleId: string, update: Partial<EditorRule>) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...update } : rule,
      ),
    }));
    setError(null);
  };
  const resetDraft = () => {
    setDraft(saved);
    setError(null);
  };

  const save = async () => {
    if (mutation.isPending) return;
    try {
      const configuration =
        kind === "gender"
          ? validateGenderRules({
              defaultGender: draft.defaultValue || null,
              rules: draft.rules.map((rule) => ({
                collections: rule.collections,
                gender: rule.value,
                id: rule.id,
              })),
            })
          : validateAgeRules({
              defaultAgeGroup: draft.defaultValue || null,
              rules: draft.rules.map((rule) => ({
                ageGroup: rule.value,
                collections: rule.collections,
                id: rule.id,
              })),
            });
      setError(null);
      const result = await mutation.mutateAsync(configuration);
      onSaved(kind, result.configuration, result.ruleJobs);
      modalRef.current?.hideOverlay();
    } catch (caught) {
      const message =
        caught instanceof AttributeRulesValidationError ||
        caught instanceof Error
          ? caught.message
          : `${title} couldn't be saved. Try again.`;
      setError(message);
      shopify.toast.show(message, { isError: true });
    }
  };

  return (
    <>
      <s-button
        command="--show"
        commandFor={modalId}
        onClick={resetDraft}
        variant="primary"
      >
        Edit {kind === "gender" ? "Gender" : "Age"} Rules
      </s-button>
      <s-modal
        accessibilityLabel={`${title} editor`}
        heading={title}
        id={modalId}
        padding="none"
        ref={modalRef}
        size="large"
      >
        <s-box padding="base">
          <div className={styles.rulesModalContent}>
            {error ? <s-banner heading={error} tone="critical" /> : null}

            <div className={styles.rulesSectionBox}>
              <s-heading>{defaultTitle}</s-heading>
              <s-paragraph color="subdued">
                Used only when no collection rule matches and the product&apos;s{" "}
                {kind === "gender" ? "Gender" : "Age Group"} metafield is empty
                or missing.
              </s-paragraph>
              <RuleValuePicker
                emptyLabel="-- None --"
                id={`${kind}-default`}
                label={defaultTitle}
                onChange={(value) => {
                  setDraft((current) => ({
                    ...current,
                    defaultValue: value,
                  }));
                  setError(null);
                }}
                options={options}
                value={draft.defaultValue}
              />
            </div>

            <div className={styles.rulesCollectionSection}>
              <div className={styles.rulesSectionHeader}>
                <div>
                  <s-heading>Collection Rules</s-heading>
                  <s-paragraph color="subdued">
                    Collection rules override the default and any existing value
                    for products in the selected collections.
                  </s-paragraph>
                </div>
                <s-button
                  disabled={draft.rules.length >= options.length}
                  onClick={() => {
                    nextRuleId.current += 1;
                    setDraft((current) => ({
                      ...current,
                      rules: [
                        ...current.rules,
                        {
                          collections: [],
                          id: `rule-${Date.now()}-${nextRuleId.current}`,
                          value: "",
                        },
                      ],
                    }));
                  }}
                  variant="secondary"
                >
                  Add rule
                </s-button>
              </div>

              <div className={styles.rulesList}>
                {draft.rules.length === 0 ? (
                  <div className={styles.rulesEmptyState}>
                    <s-text color="subdued">No collection rules added.</s-text>
                  </div>
                ) : (
                  draft.rules.map((rule, index) => {
                    const usedValues = new Set(
                      draft.rules
                        .filter(({ id }) => id !== rule.id)
                        .map(({ value }) => value)
                        .filter(Boolean),
                    );
                    return (
                      <div className={styles.ruleCard} key={rule.id}>
                        <div className={styles.ruleCardHeader}>
                          <s-heading>Rule {index + 1}</s-heading>
                          <s-button
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                rules: current.rules.filter(
                                  ({ id }) => id !== rule.id,
                                ),
                              }))
                            }
                            tone="critical"
                            variant="tertiary"
                          >
                            Remove Rule
                          </s-button>
                        </div>
                        <RuleValuePicker
                          emptyLabel={
                            kind === "gender"
                              ? "No gender selected"
                              : "No age group selected"
                          }
                          id={`${kind}-${rule.id}`}
                          label={
                            kind === "gender" ? "Rule Gender" : "Rule Age Group"
                          }
                          onChange={(value) =>
                            updateRule(rule.id, {
                              value,
                            })
                          }
                          options={options.filter(
                            ({ value }) =>
                              value === rule.value || !usedValues.has(value),
                          )}
                          value={rule.value}
                        />
                        <div className={styles.ruleCollectionsField}>
                          <span className={styles.ruleFieldLabel}>
                            Collections
                          </span>
                          <RuleCollectionPicker
                            onChange={(collections) =>
                              updateRule(rule.id, { collections })
                            }
                            ruleId={`${kind}-${rule.id}`}
                            scope={scope}
                            selected={rule.collections}
                            unavailableCollectionIds={
                              usedCollectionsByRule.get(rule.id) ?? new Set()
                            }
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </s-box>
        <s-button
          disabled={mutation.isPending}
          loading={mutation.isPending ? true : undefined}
          onClick={save}
          slot="primary-action"
          variant="primary"
        >
          Save
        </s-button>
        <s-button
          command="--hide"
          commandFor={modalId}
          disabled={mutation.isPending}
          onClick={resetDraft}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>
    </>
  );
}

export function AttributeRulesCard({
  configuration,
  initialJobs,
  scope,
}: AttributeRulesCardProps) {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    ...attributeRuleStatusQueryOptions(scope),
    initialData: initialJobs ?? undefined,
  });
  const jobs = statusQuery.data ??
    initialJobs ?? {
      age: null,
      gender: null,
    };
  const retryMutation = useMutation({
    mutationFn: (kind: AttributeRuleKind) => retryAttributeRulesRequest(kind),
    onSuccess: (result, kind) => {
      queryClient.setQueryData(
        attributeRuleStatusQueryOptions(scope).queryKey,
        result.ruleJobs,
      );
      shopify.toast.show(
        `${kind === "gender" ? "Gender" : "Age"} rules queued again.`,
      );
    },
    onError: (error) => {
      shopify.toast.show(
        error instanceof Error
          ? error.message
          : "The rules could not be retried.",
        { isError: true },
      );
    },
  });
  const completedVersions = useRef(new Set<string>());
  const genderDraft = useMemo<EditorDraft>(
    () => ({
      defaultValue: configuration?.defaultGender ?? "",
      rules:
        configuration?.genderRules.map((rule) => ({
          collections: rule.collections,
          id: rule.id,
          value: rule.gender,
        })) ?? [],
    }),
    [configuration?.defaultGender, configuration?.genderRules],
  );
  const ageDraft = useMemo<EditorDraft>(
    () => ({
      defaultValue: configuration?.defaultAgeGroup ?? "",
      rules:
        configuration?.ageRules.map((rule) => ({
          collections: rule.collections,
          id: rule.id,
          value: rule.ageGroup,
        })) ?? [],
    }),
    [configuration?.ageRules, configuration?.defaultAgeGroup],
  );

  useEffect(() => {
    const diagnosticsScope: DiagnosticsQueryScope = {
      shop: scope.shop,
      sessionId: scope.sessionId,
    };

    for (const job of [jobs.gender, jobs.age]) {
      if (job?.status !== "COMPLETED") continue;
      const key = `${job.kind}:${job.ruleVersion}`;
      if (completedVersions.current.has(key)) continue;
      completedVersions.current.add(key);
      queryClient.removeQueries({
        queryKey: diagnosticsKeys.shop(scope.shop),
      });
      queryClient.removeQueries({
        queryKey: diagnosticsKeys.clientState(diagnosticsScope),
      });
      void queryClient.invalidateQueries({
        queryKey: ["feeds", scope.shop, scope.sessionId],
      });
      void queryClient.invalidateQueries({
        queryKey: configurationQueryOptions(scope).queryKey,
      });
    }
  }, [jobs.age, jobs.gender, queryClient, scope]);

  if (!configuration) {
    return (
      <s-section heading="Gender & Age Rules">
        <div className={styles.ruleCardSkeleton}>
          <span className={styles.skeletonInput} />
        </div>
      </s-section>
    );
  }

  const onSaved = (
    kind: AttributeRuleKind,
    nextConfiguration: PublicConfiguration,
    nextJobs: PublicAttributeRuleJobs,
  ) => {
    queryClient.setQueryData(
      configurationQueryOptions(scope).queryKey,
      (current) =>
        current
          ? {
              ...current,
              configuration: nextConfiguration,
              ruleJobs: nextJobs,
            }
          : current,
    );
    queryClient.setQueryData(
      attributeRuleStatusQueryOptions(scope).queryKey,
      nextJobs,
    );
    shopify.toast.show(
      `${kind === "gender" ? "Gender" : "Age"} rules saved and are being applied.`,
    );
  };

  return (
    <s-section heading="Gender & Age Rules">
      <div className={styles.attributeRulesCard}>
        <s-paragraph color="subdued">
          Set a default gender and age group, and add collection-based
          overrides. Products without a matching rule still use the defaults.
        </s-paragraph>
        <div className={styles.attributeRuleButtons}>
          <AttributeRulesEditor
            kind="gender"
            onSaved={onSaved}
            saved={genderDraft}
            scope={scope}
          />
          <AttributeRulesEditor
            kind="age"
            onSaved={onSaved}
            saved={ageDraft}
            scope={scope}
          />
        </div>
        <div className={styles.ruleStatuses}>
          <RuleJobStatus
            job={jobs.gender}
            label="Gender rules"
            onRetry={() => retryMutation.mutate("gender")}
            retrying={
              retryMutation.isPending && retryMutation.variables === "gender"
            }
          />
          <RuleJobStatus
            job={jobs.age}
            label="Age rules"
            onRetry={() => retryMutation.mutate("age")}
            retrying={
              retryMutation.isPending && retryMutation.variables === "age"
            }
          />
        </div>
      </div>
    </s-section>
  );
}
