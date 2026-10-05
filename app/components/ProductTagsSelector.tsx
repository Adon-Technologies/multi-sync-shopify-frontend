import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeCatalogText } from "@multi-sync/catalog-rules";
import { useOverlayEvents } from "../hooks/useOverlayEvents";
import {
  productTagSuggestionsQueryOptions,
  type ConfigurationQueryScope,
} from "../services/configuration-query";
import {
  normalizeConfigurationText,
  normalizeExcludedProductTags,
} from "../services/configuration-validation";
import styles from "../styles/configurations.module.css";

export function TextListSelector({
  accessibilityLabel,
  chipAccessibilityLabel,
  duplicateError,
  emptyLabel,
  error,
  fieldLabel,
  heading,
  inputName,
  maxLength,
  modalId,
  normalize,
  onChange,
  placeholder,
  summary,
  suggestionsScope,
  value,
}: {
  accessibilityLabel: string;
  chipAccessibilityLabel: (value: string) => string;
  duplicateError: string;
  emptyLabel: string;
  error?: string;
  fieldLabel: string;
  heading: string;
  inputName: string;
  maxLength: number;
  modalId: string;
  normalize: (value: unknown) => string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  summary: (count: number) => string;
  suggestionsScope?: ConfigurationQueryScope;
  value: string[];
}) {
  const [draftValue, setDraftValue] = useState<string[]>(value);
  const [draftText, setDraftText] = useState("");
  const [draftError, setDraftError] = useState<string | undefined>();
  const [isOpen, setIsOpen] = useState(false);
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  // React 18 needs native listeners for Polaris custom-element events.
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const show = () => {
      setDraftValue(value);
      setDraftText("");
      setDraftError(undefined);
      setIsOpen(true);
    };
    const hide = () => setIsOpen(false);
    modal.addEventListener("show", show);
    modal.addEventListener("hide", hide);
    return () => {
      modal.removeEventListener("show", show);
      modal.removeEventListener("hide", hide);
    };
  }, [value]);
  useEffect(() => {
    const chips = modalRef.current?.querySelectorAll("s-clickable-chip") ?? [];
    const removers = [...chips].map((chip, index) => {
      const remove = () =>
        setDraftValue((current) =>
          current.filter((item) => item !== draftValue[index]),
        );
      chip.addEventListener("remove", remove);
      return () => chip.removeEventListener("remove", remove);
    });
    return () => removers.forEach((remove) => remove());
  }, [draftValue]);

  const addValue = () => {
    const normalizedText = suggestionsScope
      ? (normalize([draftText])[0] ?? "")
      : normalizeConfigurationText(draftText);
    if (!normalizedText) {
      setDraftError("Enter a value before adding it.");
      return;
    }

    const comparable =
      normalizeConfigurationText(normalizedText).toLocaleLowerCase();
    if (
      draftValue.some(
        (candidate) =>
          normalizeConfigurationText(candidate).toLocaleLowerCase() ===
          comparable,
      )
    ) {
      setDraftError(duplicateError);
      return;
    }

    const next = normalize([...draftValue, draftText]);
    setDraftValue(next);
    setDraftText("");
    setDraftError(undefined);
  };

  return (
    <div className={styles.optionField}>
      <s-clickable
        accessibilityLabel={accessibilityLabel}
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
            {value.length > 0 ? summary(value.length) : placeholder}
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
        accessibilityLabel={accessibilityLabel}
        heading={heading}
        id={modalId}
        ref={modalRef}
        padding="none"
        size="base"
      >
        <s-box padding="base">
          <div className={styles.textListModalContent}>
            {draftValue.length > 0 ? (
              <div className={styles.dialogTags}>
                {draftValue.map((item) => (
                  <s-clickable-chip
                    accessibilityLabel={chipAccessibilityLabel(item)}
                    key={item.toLocaleLowerCase()}
                    removable
                  >
                    {item}
                  </s-clickable-chip>
                ))}
              </div>
            ) : (
              <s-text color="subdued">{emptyLabel}</s-text>
            )}

            <form
              className={styles.termInput}
              onSubmit={(event) => {
                event.preventDefault();
                addValue();
              }}
            >
              <s-text-field
                error={draftError}
                label={fieldLabel}
                labelAccessibilityVisibility="exclusive"
                maxLength={maxLength}
                name={inputName}
                onInput={(event) => {
                  setDraftText(event.currentTarget.value);
                  setDraftError(undefined);
                }}
                placeholder={placeholder}
                value={draftText}
              />
              <s-button onClick={addValue} variant="secondary">
                Add
              </s-button>
            </form>
            {suggestionsScope && isOpen ? (
              <ProductTagSuggestions
                scope={suggestionsScope}
                search={draftText}
                selected={draftValue}
                onSelect={(tag) => {
                  setDraftValue((current) => normalize([...current, tag]));
                  setDraftText("");
                  setDraftError(undefined);
                }}
              />
            ) : null}
          </div>
        </s-box>
        <s-button
          command="--hide"
          commandFor={modalId}
          onClick={() => onChange(normalize(draftValue))}
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

function ProductTagSuggestions({
  scope,
  search,
  selected,
  onSelect,
  popover = false,
}: {
  scope: ConfigurationQueryScope;
  search: string;
  selected: string[];
  onSelect: (tag: string) => void;
  popover?: boolean;
}) {
  const query = useQuery({
    ...productTagSuggestionsQueryOptions(scope),
    retry: false,
  });
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => setVisibleCount(50), [search]);
  const selectedKeys = new Set(
    selected.map((tag) => normalizeConfigurationText(tag).toLocaleLowerCase()),
  );
  const needle = normalizeConfigurationText(search).toLocaleLowerCase();
  const matches = (query.data ?? []).filter((tag) => {
    const key = normalizeConfigurationText(tag).toLocaleLowerCase();
    return key.includes(needle) && !selectedKeys.has(key);
  });
  return (
    <div
      className={popover ? styles.popoverResults : styles.optionList}
      aria-label="Shopify product tag suggestions"
    >
      {query.isPending ? (
        <div className={styles.collectionState}>
          <s-spinner accessibilityLabel="Loading Shopify tags" size="base" />
        </div>
      ) : query.isError ? (
        <div className={styles.collectionState}>
          <s-text color="subdued">
            {popover
              ? "Shopify tags could not be loaded. You can still enter a tag and choose Add tag."
              : "Shopify tags could not be loaded. You can still enter a tag above."}
          </s-text>
          <s-button onClick={() => query.refetch()} variant="secondary">
            Retry
          </s-button>
        </div>
      ) : matches.length === 0 ? (
        <div className={styles.collectionState}>
          <s-text color="subdued">
            {needle
              ? popover
                ? "No matching Shopify tags. Choose Add tag to use your typed tag."
                : "No matching Shopify tags. Add your typed tag above."
              : popover
                ? "No Shopify tags available. You can search or enter a tag."
                : "No Shopify tags available. You can enter a tag above."}
          </s-text>
        </div>
      ) : (
        matches.slice(0, visibleCount).map((tag) => (
          <div
            className={popover ? undefined : styles.optionListItem}
            key={tag}
          >
            <s-button
              onClick={() => onSelect(tag)}
              variant={popover ? "tertiary" : "secondary"}
            >
              {tag}
            </s-button>
          </div>
        ))
      )}
      {matches.length > visibleCount ? (
        <s-button onClick={() => setVisibleCount((count) => count + 50)}>
          Show more tags
        </s-button>
      ) : null}
    </div>
  );
}

export function RuleProductTagPicker({
  onChange,
  ruleId,
  scope,
  selected,
}: {
  onChange: (tags: string[]) => void;
  ruleId: string;
  scope: ConfigurationQueryScope;
  selected: string[];
}) {
  const popoverId = `attribute-rule-tags-${ruleId}`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | undefined>();
  const searchRef = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const popoverRef = useRef<HTMLElementTagNameMap["s-popover"]>(null);
  useOverlayEvents(popoverRef, {
    onShow: () => {
      setOpen(true);
      window.requestAnimationFrame(() => searchRef.current?.focus());
    },
    onHide: (event) => {
      event.stopPropagation();
      setOpen(false);
      setSearch("");
      setError(undefined);
    },
  });
  const addTag = (input: string) => {
    const tag = normalizeExcludedProductTags([input])[0];
    if (!tag) return;
    if (tag.length > 255) {
      setError("Product tags must be at most 255 characters.");
      return;
    }
    if (
      selected.some(
        (value) => normalizeCatalogText(value) === normalizeCatalogText(tag),
      )
    ) {
      setError("This product tag has already been added.");
      return;
    }
    onChange(normalizeExcludedProductTags([...selected, tag]));
    setSearch("");
    setError(undefined);
  };
  return (
    <div className={styles.ruleCollectionPicker}>
      <s-clickable
        accessibilityLabel="Select product tags for this rule"
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
          <s-text color="subdued">Select product tags</s-text>
          <s-icon color="subdued" type="chevron-down" />
        </s-stack>
      </s-clickable>
      {selected.length > 0 ? (
        <div className={styles.tags}>
          {selected.map((tag) => (
            <span className={styles.tag} key={tag}>
              <span>{tag}</span>
              <button
                aria-label={`Remove ${tag}`}
                onClick={() =>
                  onChange(selected.filter((value) => value !== tag))
                }
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <s-popover
        blockSize="340px"
        id={popoverId}
        inlineSize="400px"
        ref={popoverRef}
      >
        <s-box padding="small-200">
          <div className={styles.configurationPopoverContent}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addTag(search);
              }}
            >
              <s-search-field
                error={error}
                label="Search store product tags"
                labelAccessibilityVisibility="exclusive"
                onInput={(event) => {
                  setSearch(event.currentTarget.value);
                  setError(undefined);
                }}
                placeholder="Search or enter a product tag"
                ref={searchRef}
                value={search}
              />
            </form>
            {open ? (
              <ProductTagSuggestions
                scope={scope}
                search={search}
                selected={selected}
                onSelect={addTag}
                popover
              />
            ) : (
              <div />
            )}
            {search.trim() ? (
              <s-button onClick={() => addTag(search)} variant="secondary">
                Add tag
              </s-button>
            ) : null}
          </div>
        </s-box>
      </s-popover>
    </div>
  );
}

export function ProductTagsSelector(props: {
  error?: string;
  modalId?: string;
  heading?: string;
  showSelectedTags?: boolean;
  onChange: (value: string[]) => void;
  scope: ConfigurationQueryScope;
  value: string[];
}) {
  const { showSelectedTags, ...selectorProps } = props;
  return (
    <>
      <TextListSelector
        accessibilityLabel={
          props.heading ? `Edit ${props.heading}` : "Edit excluded product tags"
        }
        chipAccessibilityLabel={(value) =>
          `${value}, ${props.heading ? "product tag" : "excluded product tag"}`
        }
        duplicateError="This product tag has already been added."
        emptyLabel="No product tags selected"
        fieldLabel="Search or enter a product tag"
        heading={props.heading ?? "Excluded product tags"}
        inputName={
          props.modalId ? `${props.modalId}-draft` : "excludedProductTagDraft"
        }
        maxLength={255}
        modalId={props.modalId ?? "configuration-excluded-product-tags"}
        normalize={normalizeExcludedProductTags}
        placeholder="Search or type a tag and press Enter"
        summary={(count) =>
          `${count} product tag${count === 1 ? "" : "s"} selected`
        }
        suggestionsScope={props.scope}
        {...selectorProps}
      />
      {showSelectedTags && props.value.length > 0 ? (
        <div className={styles.tags}>
          {props.value.map((tag) => (
            <span className={styles.tag} key={tag}>
              <span>{tag}</span>
              <button
                aria-label={`Remove ${tag}`}
                onClick={() =>
                  props.onChange(props.value.filter((value) => value !== tag))
                }
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
