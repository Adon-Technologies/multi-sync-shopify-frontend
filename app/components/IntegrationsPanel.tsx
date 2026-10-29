import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  metaRequest,
  oauthErrorMessage,
  type MetaStatus,
} from "../services/meta-types";
import type { DiagnosticsQueryScope } from "../services/diagnostics-query";
import { MetaSyncPanel } from "./MetaSyncPanel";

export const META_DISCONNECT_MODAL_ID = "meta-disconnect-confirmation";
export function IntegrationsPanel({
  scope,
}: {
  scope: DiagnosticsQueryScope | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const query = useQuery({
    queryKey: ["meta-integration", scope?.shop, scope?.sessionId],
    queryFn: ({ signal }) => metaRequest<MetaStatus>(undefined, signal),
    enabled: Boolean(scope),
    retry: false,
    staleTime: 0,
  });
  const data = query.data;
  const connection = data?.connection;
  const readConnected =
    ["CONNECTED_UNVERIFIED", "CONNECTED_VERIFIED"].includes(
      connection?.status ?? "",
    ) && connection?.access?.catalogMetadataRead === "VERIFIED";
  const writeVerified =
    readConnected && connection?.access.productWrite === "VERIFIED";
  const setupPath = `/app/integrations/meta${location.search}`;
  useEffect(() => {
    if (data?.setup) void navigate(setupPath, { replace: true });
  }, [data?.setup, navigate, setupPath]);

  async function act(intent: string, mode?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await metaRequest<{ authorizationUrl?: string }>({
        intent,
        mode,
      });
      if (intent === "start" && result.authorizationUrl) {
        // App Bridge v4 supports top-level external navigation through open().
        window.open(result.authorizationUrl, "_top");
      } else if (intent === "edit") {
        await navigate(setupPath);
      } else {
        await query.refetch();
        setNotice("Facebook & Instagram disconnected.");
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The connection could not be completed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <s-stack gap="base">
      <s-heading>Integrations</s-heading>
      {error || query.error ? (
        <s-banner tone="critical">
          <s-paragraph>{error || (query.error as Error).message}</s-paragraph>
          <s-button onClick={() => void query.refetch()}>Try again</s-button>
        </s-banner>
      ) : null}
      {notice ? <s-banner tone="success">{notice}</s-banner> : null}
      {data?.error ? <s-banner tone="warning">{data.error}</s-banner> : null}
      {data?.oauthError ? (
        <s-banner tone="warning">{oauthErrorMessage(data.oauthError)}</s-banner>
      ) : null}
      <s-section heading="Facebook & Instagram">
        <s-stack gap="base">
          <img src="/facebook.png" alt="Facebook" width={24} height={24} />
          <s-paragraph>
            Connect your Facebook Business Account and product catalog to
            synchronize your Shopify products with Meta.
          </s-paragraph>
          {query.isPending ? (
            <s-text>Loading connection…</s-text>
          ) : data ? (
            <>
              <s-badge
                tone={
                  writeVerified
                    ? "success"
                    : readConnected
                      ? "warning"
                      : "neutral"
                }
              >
                {connection
                  ? readConnected
                    ? writeVerified
                      ? "Connected (write access verified)"
                      : "Connected (write access unverified)"
                    : "Connection needs attention"
                  : "Not connected"}
              </s-badge>
              {connection ? (
                <>
                  <s-stack gap="small">
                    <s-paragraph>
                      Facebook Account: {connection.accountName}
                    </s-paragraph>
                    <s-paragraph>
                      Business Account: {connection.businessName} (
                      {connection.businessId})
                    </s-paragraph>
                    <s-paragraph>
                      Product Catalog: {connection.catalogName} (
                      {connection.catalogId})
                    </s-paragraph>
                  </s-stack>
                  <s-paragraph>
                    {writeVerified ? (
                      "Product write access was confirmed by a successfully processed product synchronization."
                    ) : (
                      <>
                        Product write access is unverified. It must be checked
                        when Meta confirms your first product sync. New catalog
                        connections are scheduled for the next 00:00 UTC after
                        confirmation. Sync now can start an earlier manual sync.
                      </>
                    )}
                  </s-paragraph>
                  <s-stack direction="inline" gap="small">
                    <s-button
                      disabled={busy || undefined}
                      loading={busy || undefined}
                      onClick={() => void act("start")}
                    >
                      Change Account
                    </s-button>
                    <s-button
                      disabled={busy || undefined}
                      onClick={() => void act("edit", "business")}
                    >
                      Change Business
                    </s-button>
                    <s-button
                      disabled={busy || undefined}
                      onClick={() => void act("edit", "catalog")}
                    >
                      Change Catalog
                    </s-button>
                    <s-button
                      tone="critical"
                      command="--show"
                      commandFor={META_DISCONNECT_MODAL_ID}
                      disabled={busy || undefined}
                    >
                      Disconnect
                    </s-button>
                  </s-stack>
                  {readConnected ? (
                    <MetaSyncPanel
                      scope={scope}
                      catalogId={connection.catalogId}
                      catalogName={connection.catalogName}
                      onCompleted={() => {
                        void query.refetch();
                      }}
                    />
                  ) : null}
                </>
              ) : (
                <s-button
                  variant="primary"
                  disabled={busy || undefined}
                  loading={busy || undefined}
                  onClick={() => void act("start")}
                >
                  Connect with Facebook
                </s-button>
              )}
            </>
          ) : null}
        </s-stack>
      </s-section>
      {connection ? (
        <s-modal
          id={META_DISCONNECT_MODAL_ID}
          heading="Disconnect Facebook & Instagram?"
          accessibilityLabel="Disconnect Meta catalog confirmation"
        >
          <s-stack gap="small">
            <s-paragraph>
              Disconnecting removes Multi Sync&apos;s connection to the selected
              Meta catalog and its locally stored credentials. Your Meta
              Business Account, catalog, products and Product Sets will remain
              in Meta.
            </s-paragraph>
            <s-paragraph>
              To revoke app access completely, remove Multi Sync in Meta
              Business Integrations. This can affect other stores connected with
              the same Facebook account.
            </s-paragraph>
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            disabled={busy || undefined}
            command="--hide"
            commandFor={META_DISCONNECT_MODAL_ID}
            onClick={() => void act("disconnect")}
          >
            Disconnect
          </s-button>
          <s-button
            slot="secondary-actions"
            command="--hide"
            commandFor={META_DISCONNECT_MODAL_ID}
          >
            Keep connection
          </s-button>
        </s-modal>
      ) : null}
    </s-stack>
  );
}
