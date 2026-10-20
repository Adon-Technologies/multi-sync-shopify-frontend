import { useEffect, useRef, useState } from "react";
import { PolarisSelect } from "./PolarisFormControls";
import {
  metaRequest,
  type MetaOption,
  type MetaStatus,
} from "../services/meta-types";

export function MetaConnectionSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<MetaStatus["setup"]>(null);
  const [businesses, setBusinesses] = useState<MetaOption[]>([]);
  const [catalogs, setCatalogs] = useState<MetaOption[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const showError = (failure: unknown) =>
    setError(
      failure instanceof Error
        ? failure.message
        : "Meta is unavailable. Try again.",
    );

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSetup(null);
    setBusinesses([]);
    void (async () => {
      try {
        const status = await metaRequest<MetaStatus>(
          undefined,
          controller.signal,
        );
        if (!status.setup)
          throw new Error(
            "This connection setup expired. Return to Integrations and connect with Facebook again.",
          );
        const result = await metaRequest<{ businesses: MetaOption[] }>(
          { intent: "businesses", attemptId: status.setup.id },
          controller.signal,
        );
        if (live) {
          setSetup(status.setup);
          setBusinesses(result.businesses);
          setBusinessId((current) =>
            result.businesses.some((item) => item.id === current)
              ? current
              : (status.setup!.businessId ?? ""),
          );
        }
      } catch (failure) {
        if (live) showError(failure);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!setup || !businessId || loading) {
      setCatalogs([]);
      setCatalogId("");
      return;
    }
    let live = true;
    const controller = new AbortController();
    setCatalogLoading(true);
    setWarnings([]);
    setCatalogs([]);
    setCatalogId("");
    setError(null);
    void metaRequest<{ catalogs: MetaOption[]; warnings?: string[] }>(
      { intent: "catalogs", attemptId: setup.id, businessId },
      controller.signal,
    )
      .then((result) => {
        if (live) {
          setCatalogs(result.catalogs);
          setWarnings(result.warnings ?? []);
        }
      })
      .catch((failure) => {
        if (live) showError(failure);
      })
      .finally(() => {
        if (live) setCatalogLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [setup, businessId, loading, refresh]);

  async function act(intent: "confirm" | "cancel") {
    if (lock.current || !setup) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await metaRequest({ intent, attemptId: setup.id, businessId, catalogId });
      onDone();
    } catch (failure) {
      showError(failure);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <s-stack gap="base">
      <s-button
        onClick={() => (setup ? void act("cancel") : onDone())}
        disabled={busy || undefined}
      >
        ← Back to Integrations
      </s-button>
      <s-heading>Select Business Account</s-heading>
      {error ? <s-banner tone="critical">{error}</s-banner> : null}
      <s-section>
        <s-stack gap="base">
          {loading ? (
            <s-text>Loading Business Accounts…</s-text>
          ) : setup ? (
            <>
              <s-paragraph>Facebook Account: {setup.accountName}</s-paragraph>
              {businesses.length ? (
                <PolarisSelect
                  label="Business Account"
                  value={businessId}
                  disabled={busy}
                  onChange={(event) => setBusinessId(event.currentTarget.value)}
                >
                  <s-option value="">Select a Business Account</s-option>
                  {businesses.map((item) => (
                    <s-option key={item.id} value={item.id}>
                      {item.name} ({item.id})
                    </s-option>
                  ))}
                </PolarisSelect>
              ) : (
                <s-paragraph>
                  No Business Accounts are available. Ask a business
                  administrator to grant you access, then refresh.
                </s-paragraph>
              )}
              {businessId ? (
                <>
                  <s-heading>Select Product Catalog</s-heading>
                  {warnings.map((warning) => (
                    <s-banner key={warning} tone="warning">
                      {warning}
                    </s-banner>
                  ))}
                  {catalogLoading ? (
                    <s-text>Loading product catalogs…</s-text>
                  ) : catalogs.length ? (
                    <PolarisSelect
                      label="Product Catalog"
                      value={catalogId}
                      disabled={busy}
                      onChange={(event) =>
                        setCatalogId(event.currentTarget.value)
                      }
                    >
                      <s-option value="">Select a Product Catalog</s-option>
                      {catalogs.map((item) => (
                        <s-option key={item.id} value={item.id}>
                          {item.name} ({item.id})
                        </s-option>
                      ))}
                    </PolarisSelect>
                  ) : !error ? (
                    <s-stack gap="small">
                      <s-paragraph>
                        No ecommerce product catalogs are available for this
                        business. Create a catalog in Meta Commerce Manager or
                        ask its owner to share it with you, then refresh the
                        list.
                      </s-paragraph>
                      <s-link
                        href="https://business.facebook.com/commerce/"
                        target="_blank"
                      >
                        Open Meta Commerce Manager
                      </s-link>
                    </s-stack>
                  ) : null}
                  <s-paragraph>
                    Multi Sync will verify catalog read access and its Business
                    Account before saving. Product write access will remain
                    unverified until an authorized product sync confirms it.
                  </s-paragraph>
                </>
              ) : null}
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  disabled={
                    !businessId ||
                    !catalogId ||
                    busy ||
                    catalogLoading ||
                    loading ||
                    undefined
                  }
                  loading={busy || undefined}
                  onClick={() => void act("confirm")}
                >
                  Connect Catalog
                </s-button>
                <s-button
                  disabled={busy || catalogLoading || undefined}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  Refresh list
                </s-button>
                <s-button
                  disabled={busy || undefined}
                  onClick={() => void act("cancel")}
                >
                  Cancel
                </s-button>
              </s-stack>
            </>
          ) : (
            <s-stack direction="inline" gap="small">
              <s-button onClick={() => setRefresh((value) => value + 1)}>
                Try again
              </s-button>
              <s-button onClick={onDone}>Return to Integrations</s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-stack>
  );
}
