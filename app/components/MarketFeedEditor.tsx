import { PolarisSelect } from "./PolarisFormControls";
import { PolarisSwitch } from "./PolarisSwitch";
import { useEffect, useRef, useState } from "react";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
  useRevalidator,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeCountryCode } from "@multi-sync/catalog-rules";
import {
  pickMarketConfiguration,
  validateMarketConfiguration,
  MARKET_CONFIGURATION_SECTIONS,
} from "@multi-sync/catalog-rules/market-configuration";
import type { loadMarketFeedEditor } from "../services/market-feed-editor.server";
import { ConfigurationsPanel, configurationForm } from "./ConfigurationsPanel";
import { configurationQueryOptions } from "../services/configuration-query";
import {
  additionalFeedsQueryOptions,
  additionalLanguagesQueryOptions,
  checkAdditionalFeedBilling,
  feedKeys,
  generateAdditionalFeed,
  renewAdditionalFeedSubscription,
} from "../services/feed-query";
import { saveMarketConfiguration, updateMarketFeedCache } from "../services/market-configuration-query";
import {
  validateConfigurationInput,
  type ConfigurationInput,
} from "../services/configuration-validation";
import { formatFeedGenerationProgress } from "../services/feed-generation-state";
import { useHydrated } from "../hooks/useHydrated";
import styles from "../styles/market-feed.module.css";

export function MarketFeedEditor() {
  const data = useLoaderData<typeof loadMarketFeedEditor>();
  const location = useLocation();
  return (
    <MarketFeedForm
      key={`${location.pathname}${location.search}`}
      data={data}
    />
  );
}

export function MarketFeedErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <header className={styles.header}><s-heading>Market feed</s-heading></header>
        <s-link
          href="/app/feeds"
          onClick={(event) => {
            event.preventDefault();
            navigate("/app/feeds");
          }}
        >
          {"\u2190"} Feeds
        </s-link>
        <s-banner heading="Market feed setup could not be loaded" tone="critical">
          <s-paragraph>
            {error instanceof Error
              ? error.message
              : "The market may no longer be available. Return to Feeds or try again."}
          </s-paragraph>
          <s-button
            loading={revalidator.state === "loading" ? true : undefined}
            onClick={() => void revalidator.revalidate()}
          >
            Retry
          </s-button>
        </s-banner>
      </main>
    </div>
  );
}

function MarketFeedForm({
  data,
}: {
  data: Awaited<ReturnType<typeof loadMarketFeedEditor>>;
}) {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const editing = Boolean(data.settings);
  const configuring = editing || Boolean(data.selection);
  const [marketValue, setMarketValue] = useState(
    data.selection?.market.value ?? "",
  );
  const [locale, setLocale] = useState(data.selection?.language.locale ?? "");
  const [countryCode, setCountryCode] = useState(
    data.settings?.entry.feed.idCountryCode ??
      data.selection?.idCountryCode ??
      data.primary.countryCode,
  );
  const [customEnabled, setCustomEnabled] = useState(
    data.settings?.entry.feed.customConfigurationEnabled === true,
  );
  const [custom, setCustom] = useState<Record<string, unknown> | null>(
    data.settings?.customConfiguration ?? null,
  );
  const [primary, setPrimary] = useState(configurationForm(data.primary));
  const [savedDraft, setSavedDraft] = useState(() => ({
    countryCode,
    customEnabled,
    custom,
  }));
  const [discardRevision, setDiscardRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingFeedId, setPendingFeedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const paidModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const renewalModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const [renewal, setRenewal] = useState<{
    subscriptionId: string;
    url: string;
  } | null>(null);
  const [renewed, setRenewed] = useState(false);
  const selectedMarket = data.options.find(
    (option) => option.value === marketValue,
  );
  const languagesQuery = useQuery({
    ...additionalLanguagesQueryOptions(
      data.scope,
      selectedMarket?.marketId ?? "",
      selectedMarket?.countryCode ?? "",
    ),
    enabled: !configuring && Boolean(selectedMarket),
    staleTime: 0,
  });
  const generationQuery = useQuery({
    ...additionalFeedsQueryOptions(data.scope),
    enabled: Boolean(pendingFeedId),
    staleTime: 0,
    refetchInterval: pendingFeedId ? 2000 : false,
  });
  const pendingFeed = generationQuery.data?.ok
    ? generationQuery.data.feeds.find(
        (entry) => entry.feed.id === pendingFeedId,
      )?.feed
    : null;
  const returnToFeeds = () => navigate("/app/feeds");
  useEffect(() => {
    if (pendingFeed?.status === "COMPLETED") {
      void queryClient.invalidateQueries({
        queryKey: feedKeys.all(data.scope),
      });
      shopify.toast.show("Market feed generated.");
      navigate("/app/feeds");
    } else if (pendingFeed?.status === "FAILED") {
      setError(pendingFeed.lastError ?? "Feed generation failed. Try again.");
      setPendingFeedId(null);
    }
  }, [pendingFeed, queryClient, data.scope, shopify, navigate]);
  const latestPrimary = async () => {
    const current = await queryClient.fetchQuery({
      ...configurationQueryOptions(data.scope),
      staleTime: 0,
    });
    const value = configurationForm(current.configuration);
    setPrimary(value);
    return value;
  };
  const enableCustom = async (enabled: boolean) => {
    if (inFlight.current || pendingFeedId) return;
    if (!enabled) {
      setCustomEnabled(false);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = await latestPrimary();
      setCustom((previous) => ({
        ...pickMarketConfiguration(current),
        ...(previous ?? {}),
      }));
      setCustomEnabled(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Primary configuration could not be loaded.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const copy = async (section: string) => {
    if (inFlight.current || pendingFeedId) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = pickMarketConfiguration(await latestPrimary());
      const fields =
        MARKET_CONFIGURATION_SECTIONS[
          section as keyof typeof MARKET_CONFIGURATION_SECTIONS
        ];
      setCustom((previous) => ({
        ...previous,
        ...Object.fromEntries(
          fields.map((field) => [field, structuredClone(current[field])]),
        ),
      }));
      shopify.toast.show("Copied from Primary. Save to apply these settings.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Primary configuration could not be loaded.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const create = () => {
    const code = normalizeCountryCode(countryCode);
    if (
      !selectedMarket ||
      !locale ||
      !languagesQuery.data?.ok ||
      !languagesQuery.data.languages.some(
        (language) => language.locale === locale,
      ) ||
      !code
    ) {
      setError(
        "Choose a market, an available language, and a 1-3 letter Country Code.",
      );
      return;
    }
    // Navigation only: no database record, generation, upload, or billing.
    navigate(
      `/app/market-feed/configure?${new URLSearchParams({ marketId: selectedMarket.marketId, countryCode: selectedMarket.countryCode, locale, idCountryCode: code })}`,
    );
  };
  const submit = async (paidFeedConfirmed = false) => {
    if (inFlight.current || pendingFeedId) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const code = normalizeCountryCode(countryCode);
      if (!code) throw new Error("Enter a 1-3 letter country code.");
      const settings = customEnabled
        ? validateMarketConfiguration(
            pickMarketConfiguration(
              validateConfigurationInput({ ...primary, ...custom }),
            ),
          )
        : undefined;
      if (editing && data.settings) {
        const result = await saveMarketConfiguration({
          feedId: data.settings.entry.feed.id,
          expectedRevision:
            data.settings.entry.feed.marketConfigurationRevision ?? 0,
          idCountryCode: code,
          customConfigurationEnabled: customEnabled,
          ...(settings ? { customConfiguration: settings } : {}),
        });
        updateMarketFeedCache(queryClient, data.scope, result);
        await queryClient.invalidateQueries({
          queryKey: feedKeys.all(data.scope),
          refetchType: "all",
        });
        setSavedDraft({ countryCode: code, customEnabled, custom: settings ?? custom });
        setCountryCode(code);
        if (settings) setCustom(settings);
        shopify.toast.show(
          "Market settings saved. Refresh this feed to apply changes.",
        );
        returnToFeeds();
      } else if (data.selection) {
        if (!paidFeedConfirmed) {
          const feeds = await queryClient.fetchQuery({
            ...additionalFeedsQueryOptions(data.scope),
            staleTime: 0,
          });
          if (!feeds.ok) throw new Error(feeds.error);
          if (!feeds.usage)
            throw new Error(
              "Your feed allowance could not be verified. Try again.",
            );
          if (
            feeds.usage.additionalFeedCount >=
            feeds.usage.entitlements.includedAdditionalFeeds
          ) {
            const eligibility = await checkAdditionalFeedBilling();
            if (eligibility.requiresRenewal) {
              setRenewal(eligibility);
              renewalModal.current?.showOverlay();
            } else paidModal.current?.showOverlay();
            return;
          }
        }
        const result = await generateAdditionalFeed({
          marketId: data.selection.market.marketId,
          countryCode: data.selection.market.countryCode,
          locale: data.selection.language.locale,
          idCountryCode: code,
          paidFeedConfirmed,
          customConfigurationEnabled: customEnabled,
          ...(settings ? { customConfiguration: settings } : {}),
        });
        if (!result.ok || !result.entry)
          throw new Error(
            !result.ok ? result.error : "Feed generation could not be started.",
          );
        setPendingFeedId(result.entry.feed.id);
        await queryClient.invalidateQueries({
          queryKey: feedKeys.all(data.scope),
        });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The market feed could not be saved. Try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const locked =
    busy ||
    Boolean(pendingFeedId) ||
    ["QUEUED", "PROCESSING"].includes(data.settings?.entry.feed.status ?? "");
  const hasUnsavedChanges = editing && (
    countryCode !== savedDraft.countryCode ||
    customEnabled !== savedDraft.customEnabled ||
    (customEnabled && JSON.stringify(pickMarketConfiguration({ ...primary, ...custom })) !==
      JSON.stringify(pickMarketConfiguration({ ...primary, ...savedDraft.custom })))
  );
  const discard = () => {
    if (locked || inFlight.current) return;
    setCountryCode(savedDraft.countryCode);
    setCustomEnabled(savedDraft.customEnabled);
    setCustom(savedDraft.custom);
    setError(null);
    setDiscardRevision((revision) => revision + 1);
  };
  const context = data.settings
    ? [
        data.settings.entry.market.name,
        data.settings.entry.market.countryName ??
          data.settings.entry.market.countryCode,
        data.settings.entry.market.languageName ??
          data.settings.entry.market.locale,
      ]
    : data.selection
      ? [
          data.selection.market.marketName,
          data.selection.market.countryName,
          data.selection.language.name,
        ]
      : [];
  return (
    <div className={styles.page}>
      {hydrated && editing ? (
        <SaveBar id="market-configuration-save-bar" open={hasUnsavedChanges}>
          <button
            variant="primary"
            disabled={locked || !hasUnsavedChanges}
            loading={busy ? "" : undefined}
            onClick={() => void submit()}
          >
            Save
          </button>
          <button disabled={locked} onClick={discard}>
            Discard
          </button>
        </SaveBar>
      ) : null}
      <main className={styles.content}>
        <header className={styles.header}>
          <s-heading>{editing ? "Edit market feed" : "New market feed"}</s-heading>
        </header>
        <s-link
          href="/app/feeds"
          onClick={(event) => {
            event.preventDefault();
            returnToFeeds();
          }}
        >
          {"\u2190"} Feeds
        </s-link>
        <div className={`${styles.editor} ${!configuring ? styles.setup : ""}`}>
          {error ? (
            <s-banner
              tone="critical"
              heading="The feed request could not be completed"
            >
              {error}
            </s-banner>
          ) : null}
          {configuring ? (
            <>
              <s-section heading="Market feed">
                <s-stack direction="block" gap="base">
                  <s-paragraph>{context.filter(Boolean).join(" · ")}</s-paragraph>
                  {editing ? (
                    <s-text-field
                      label="Country Code (Feed Product ID)"
                      value={countryCode}
                      maxLength={3}
                      disabled={locked ? true : undefined}
                      onInput={(event) =>
                        setCountryCode(event.currentTarget.value.toUpperCase())
                      }
                    />
                  ) : (
                    <s-text>Country Code: {countryCode}</s-text>
                  )}
                </s-stack>
              </s-section>
              <s-section heading="Configuration">
                <PolarisSwitch
                  label="Customize configuration"
                  checked={customEnabled}
                  disabled={locked ? true : undefined}
                  onChange={(enabled) => void enableCustom(enabled)}
                />
                <s-paragraph color="subdued">
                  {customEnabled
                    ? "Use your own settings for this market feed. Color, size, gender, and age settings continue to follow Primary."
                    : "Uses the same configuration as the Primary Feed, including future changes."}
                </s-paragraph>
              </s-section>
              {customEnabled && custom ? (
                <div {...(locked ? { inert: "" } : {})}>
                  <ConfigurationsPanel
                    key={discardRevision}
                    active
                    scope={data.scope}
                    onOpenFeeds={returnToFeeds}
                    market={{
                      value: { ...primary, ...custom } as ConfigurationInput,
                      onChange: (value) =>
                        setCustom(pickMarketConfiguration(value)),
                      onCopy: (section) => void copy(section),
                    }}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <s-section heading="Market details">
              <s-stack direction="block" gap="base">
                <PolarisSelect
                  label="Market"
                  value={marketValue}
                  onChange={(event) => {
                    setMarketValue(event.currentTarget.value);
                    setLocale("");
                    setError(null);
                  }}
                >
                  <s-option value="">Choose a market and country</s-option>
                  {data.options.map((option) => (
                    <s-option key={option.value} value={option.value}>
                      {option.marketName} / {option.countryName} (
                      {option.currencyCode})
                    </s-option>
                  ))}
                </PolarisSelect>
                <PolarisSelect
                  label="Language"
                  value={locale}
                  disabled={!selectedMarket || languagesQuery.isFetching}
                  onChange={(event) => setLocale(event.currentTarget.value)}
                >
                  <s-option value="">
                    {languagesQuery.isFetching
                      ? "Loading languages…"
                      : "Choose a language"}
                  </s-option>
                  {languagesQuery.data?.ok
                    ? languagesQuery.data.languages.map((language) => (
                        <s-option key={language.locale} value={language.locale}>
                          {language.name}
                        </s-option>
                      ))
                    : null}
                </PolarisSelect>
                {languagesQuery.isError ? (
                  <s-banner tone="critical">
                    Languages could not be loaded.{" "}
                    <s-button onClick={() => void languagesQuery.refetch()}>
                      Retry
                    </s-button>
                  </s-banner>
                ) : null}
                <s-text-field
                  label="Country Code (Feed Product ID)"
                  value={countryCode}
                  maxLength={3}
                  onInput={(event) =>
                    setCountryCode(event.currentTarget.value.toUpperCase())
                  }
                  details="1-3 letter country code used in Google product IDs."
                />
                {!data.options.length ? (
                  <s-paragraph>
                    No available Market and language combinations. Manage Shopify
                    Markets to add more.
                  </s-paragraph>
                ) : null}
              </s-stack>
            </s-section>
          )}
          {pendingFeedId ? (
            <s-banner heading="Generating market feed">
              <s-paragraph>
                {pendingFeed
                  ? (formatFeedGenerationProgress(pendingFeed) ??
                    "Waiting for generation to complete…")
                  : "Waiting for generation to start…"}
              </s-paragraph>
              {generationQuery.isError ? (
                <s-paragraph>
                  Status is temporarily unavailable. Generation may still be
                  running.{" "}
                  <s-button onClick={() => void generationQuery.refetch()}>
                    Check status
                  </s-button>
                </s-paragraph>
              ) : null}
            </s-banner>
          ) : null}
          {!editing ? <s-stack direction="inline" justifyContent="end" gap="base">
            <s-button onClick={returnToFeeds} disabled={busy ? true : undefined}>
              Back to Feeds
            </s-button>
            <s-button
              variant="primary"
              disabled={locked ? true : undefined}
              loading={busy || Boolean(pendingFeedId) ? true : undefined}
              onClick={() => (configuring ? void submit() : create())}
            >
              {configuring ? "Generate feed" : "Create feed"}
            </s-button>
          </s-stack> : null}
        </div>
        <s-modal
          id="market-paid-confirmation"
          heading="Add paid feed?"
          ref={paidModal}
        >
          <s-paragraph>
            This feed exceeds your included allowance and adds $1.49/month in
            usage charges to your Shopify app bill.
          </s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            disabled={locked ? true : undefined}
            onClick={() => {
              paidModal.current?.hideOverlay();
              void submit(true);
            }}
          >
            Add feed for $1.49/month
          </s-button>
          <s-button
            slot="secondary-actions"
            command="--hide"
            commandFor="market-paid-confirmation"
          >
            Cancel
          </s-button>
        </s-modal>
        <s-modal
          id="market-renewal"
          heading="Update your subscription to add more feeds"
          ref={renewalModal}
        >
          <s-paragraph>
            Your current subscription does not include paid Additional Market
            feeds. Cancel and select a plan with usage billing on Shopify.
            Cancellation takes effect immediately and access pauses until you
            approve the replacement. Additional feeds cost $1.49/month each.
            Shopify determines charges and credits; a new free trial is not
            guaranteed.
          </s-paragraph>
          {renewed && renewal ? (
            <s-link href={renewal.url} target="_top">
              Continue on Shopify
            </s-link>
          ) : null}
          <s-button
            slot="primary-action"
            variant="primary"
            disabled={busy || renewed ? true : undefined}
            loading={busy ? true : undefined}
            onClick={() => {
              if (!renewal || inFlight.current) return;
              inFlight.current = true;
              setBusy(true);
              void renewAdditionalFeedSubscription(renewal.subscriptionId)
                .then((result) => {
                  setRenewed(true);
                  setRenewal({ ...renewal, url: result.url });
                  window.open(result.url, "_top");
                })
                .catch((cause) => setError(cause.message))
                .finally(() => {
                  inFlight.current = false;
                  setBusy(false);
                });
            }}
          >
            Cancel and resubscribe
          </s-button>
          <s-button
            slot="secondary-actions"
            command="--hide"
            commandFor="market-renewal"
            disabled={busy ? true : undefined}
          >
            Not now
          </s-button>
        </s-modal>
      </main>
    </div>
  );
}
