import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metaRequest } from "../services/meta-types";
import type { DiagnosticsQueryScope } from "../services/diagnostics-query";

export interface MetaSyncStatus {
  enabled: boolean;
  automaticSyncEnabled?: boolean;
  automaticSyncError?: string | null;
  automaticSyncQueued?: boolean;
  nextAutomaticSyncAt?: string | null;
  lastSuccessfulSync: string | null;
  run: null | {
    id: string;
    status: string;
    active: boolean;
    enumerationComplete: boolean;
    total: number;
    processed: number;
    succeeded: number;
    warnings?: number;
    failed: number;
    excluded: number;
    staleItems: number;
    error: string | null;
  };
}
const labels: Record<string, string> = {
  PREPARING: "Preparing",
  SYNCHRONIZING: "Synchronizing",
  PROCESSING: "Processing in Meta",
  COMPLETED: "Completed",
  COMPLETED_WITH_WARNINGS: "Completed with warnings",
  LEGACY_TEST: "Previous limited test",
  NO_ELIGIBLE_PRODUCTS: "Nothing submitted",
  COMPLETED_WITH_ERRORS: "Completed with errors",
  NEEDS_ATTENTION: "Needs attention",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};
export function MetaSyncPanel({
  scope,
  catalogId,
  catalogName,
  onCompleted,
}: {
  scope: DiagnosticsQueryScope | null;
  catalogId: string | null;
  catalogName: string | null;
  onCompleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const notified = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ["meta-sync", scope?.shop, scope?.sessionId, catalogId],
    queryFn: ({ signal }) =>
      metaRequest<MetaSyncStatus>({ intent: "sync-status" }, signal),
    enabled: Boolean(scope && catalogId),
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.run?.active || q.state.data?.automaticSyncQueued
        ? 5000
        : 30_000,
  });
  const run = query.data?.run;
  useEffect(() => {
    if (run && !run.active && notified.current !== run.id) {
      notified.current = run.id;
      onCompleted();
    }
  }, [run, onCompleted]);
  async function start() {
    if (lock.current || run?.active || !query.data?.enabled) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await metaRequest({
        intent: query.data?.automaticSyncEnabled ? "sync-start" : "sync-enable",
        confirmed: true,
      });
      await query.refetch();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Synchronization could not start.",
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <s-stack gap="small">
      <s-heading>Product synchronization</s-heading>
      {query.data?.automaticSyncQueued ? (
        <s-banner tone="info">
          The daily 00:00 UTC product sync is due. It will start when the worker
          is available and the current sync has finished.
        </s-banner>
      ) : null}
      <s-paragraph>
        {query.data?.automaticSyncEnabled
          ? "Automatic sync runs once daily at 00:00 UTC. Product and inventory changes are included in the next daily sync. Use Sync now for an earlier update."
          : "Enable automatic sync to synchronize eligible products and variants once daily at 00:00 UTC."}
      </s-paragraph>
      {query.data?.automaticSyncEnabled && query.data.nextAutomaticSyncAt ? (
        <s-paragraph>
          Next scheduled sync:{" "}
          {new Date(query.data.nextAutomaticSyncAt)
            .toISOString()
            .replace("T", " ")
            .replace(".000Z", " UTC")}
          .
        </s-paragraph>
      ) : null}
      {query.data?.automaticSyncError ? (
        <s-banner tone="warning">{query.data.automaticSyncError}</s-banner>
      ) : null}
      <s-badge
        tone={
          run?.status === "COMPLETED"
            ? "success"
            : run?.status === "NEEDS_ATTENTION" ||
                run?.status === "COMPLETED_WITH_ERRORS" ||
                run?.status === "COMPLETED_WITH_WARNINGS" ||
                run?.status === "NO_ELIGIBLE_PRODUCTS" ||
                run?.status === "LEGACY_TEST"
              ? "warning"
              : "neutral"
        }
      >
        {run ? (labels[run.status] ?? "Needs attention") : "Not synced"}
      </s-badge>
      {error || query.error ? (
        <s-banner tone="critical">
          {error || (query.error as Error).message}
        </s-banner>
      ) : null}
      {run?.error ? <s-banner tone="warning">{run.error}</s-banner> : null}
      {run?.warnings ? (
        <s-banner tone="warning">
          Some items were processed with warnings. Review Facebook Diagnostics.
          A constructed product URL does not confirm public storefront access or
          advertising eligibility.
        </s-banner>
      ) : null}
      {run ? (
        <>
          <s-paragraph>
            Eligible variants{run.enumerationComplete ? "" : " found so far"}:{" "}
            {run.total}. Processed: {run.processed}. Synchronized:{" "}
            {run.succeeded}. Failed: {run.failed}. Excluded: {run.excluded}.
            Warnings: {run.warnings ?? 0}.
          </s-paragraph>
          {run.active ? (
            <>
              <progress
                aria-label="Meta product synchronization progress"
                value={run.processed}
                max={Math.max(1, run.total)}
              />
              <s-text>
                The job continues in the background. You can leave this page.
              </s-text>
            </>
          ) : null}
          {run.staleItems ? (
            <s-paragraph>
              {run.staleItems} previously managed items require removal in Meta.
              Automatic removal is not implemented.
            </s-paragraph>
          ) : null}
        </>
      ) : null}
      <s-paragraph>
        Last successful sync:{" "}
        {query.data?.lastSuccessfulSync
          ? new Date(query.data.lastSuccessfulSync).toLocaleString()
          : "Never"}
      </s-paragraph>
      {query.data && !query.data.enabled ? (
        <s-banner tone="info">
          Meta product synchronization is disabled. Configure the backend
          database, indexes and worker before enabling it.
        </s-banner>
      ) : null}
      <s-button
        variant="primary"
        command="--show"
        commandFor="meta-sync-confirmation"
        disabled={
          busy || Boolean(run?.active) || !query.data?.enabled || undefined
        }
        loading={busy || undefined}
      >
        {query.data?.automaticSyncEnabled
          ? "Sync now"
          : "Enable automatic sync"}
      </s-button>
      <s-modal
        id="meta-sync-confirmation"
        heading={
          query.data?.automaticSyncEnabled
            ? "Synchronize Shopify products?"
            : "Enable automatic product sync?"
        }
        accessibilityLabel="Confirm Meta product synchronization"
      >
        <s-stack gap="small">
          <s-paragraph>
            {query.data?.automaticSyncEnabled
              ? "Sync now starts an immediate manual update of eligible Shopify products and variants in "
              : "Enable daily updates of eligible Shopify products and variants in "}
            {catalogName || "your selected Meta catalog"}.
            {query.data?.automaticSyncEnabled
              ? " The daily 00:00 UTC schedule stays unchanged."
              : " The first automatic sync runs at the next 00:00 UTC. Sync now can start an earlier manual import."}{" "}
            Existing matching Multi Sync-managed items may be updated. Shopify
            products will not be edited.
          </s-paragraph>
          <s-paragraph>
            Active, published products follow your product selection, exclusion
            and attribute rules. Shop currency is used. Condition defaults to
            new unless a supported condition metafield is present. Out-of-stock
            items remain listed with their availability.
          </s-paragraph>
          <s-paragraph>
            Large stores may take time. Meta processing must finish before items
            are marked Submitted. Missing or newly excluded items are reported
            for manual removal; this sync does not delete catalog items.
          </s-paragraph>
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          command="--hide"
          commandFor="meta-sync-confirmation"
          disabled={
            busy || Boolean(run?.active) || !query.data?.enabled || undefined
          }
          onClick={() => void start()}
        >
          {query.data?.automaticSyncEnabled
            ? "Start synchronization"
            : "Enable daily sync"}
        </s-button>
        <s-button
          slot="secondary-actions"
          command="--hide"
          commandFor="meta-sync-confirmation"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-stack>
  );
}
