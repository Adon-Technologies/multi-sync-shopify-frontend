import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppBridge } from "@shopify/app-bridge-react";

import { remainingTrialMessage, remainingTrialTime } from "../billing/types";
import type { SubscriptionView } from "../billing/types";
import {
  cancelSubscription,
  forceSyncSubscription,
  subscriptionKeys,
  subscriptionQueryOptions,
} from "../services/subscription-query";
import styles from "../styles/dashboard.module.css";
import {
  CANCEL_SUBSCRIPTION_MODAL_ID,
  CancelSubscriptionModal,
} from "./CancelSubscriptionModal";

interface SubscriptionStatusProps {
  initialSubscription?: SubscriptionView | null;
  planSelectionUrl?: string | null;
  shop: string | null;
}

function useCurrentTime(enabled: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, [enabled]);
  return now;
}

export function formatSubscriptionDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function useSubscription(
  shop: string | null,
  initialSubscription?: SubscriptionView | null,
) {
  return useQuery({
    ...subscriptionQueryOptions(shop ?? "pending-shop"),
    enabled: Boolean(shop),
    initialData: initialSubscription ?? undefined,
    initialDataUpdatedAt: initialSubscription?.lastSyncedAt
      ? new Date(initialSubscription.lastSyncedAt).getTime()
      : undefined,
  });
}

export function InactivePlanBanner({
  planSelectionUrl,
}: Pick<SubscriptionStatusProps, "planSelectionUrl">) {
  return (
    <div className={styles.subscriptionBanner}>
      <s-banner heading="Your plan is inactive" tone="critical">
        <s-paragraph>
          Your subscription is no longer active. Choose a plan to continue using
          Multi-Sync.
        </s-paragraph>
        {planSelectionUrl ? (
          <s-button
            href={planSelectionUrl}
            slot="primary-action"
            target="_top"
            variant="primary"
          >
            Choose a plan
          </s-button>
        ) : null}
      </s-banner>
    </div>
  );
}

export function BillingAccessGate({
  canUseApp,
  children,
  planSelectionUrl,
}: {
  canUseApp: boolean;
  children: ReactNode;
  planSelectionUrl: string | null;
}) {
  if (canUseApp) return children;

  return (
    <>
      <InactivePlanBanner planSelectionUrl={planSelectionUrl} />
      <fieldset
        {...({ inert: "" } as { inert: string })}
        aria-disabled="true"
        className={styles.inactivePlanContent}
        disabled
      >
        {children}
      </fieldset>
    </>
  );
}

export function SubscriptionBanner({
  initialSubscription,
  shop,
}: SubscriptionStatusProps) {
  const query = useSubscription(shop, initialSubscription);
  const refetch = query.refetch;
  const trialEndsAt = query.data?.trialEndsAt ?? null;
  const isFetching = query.isFetching;
  const isTrial = query.data?.status === "TRIAL" && Boolean(trialEndsAt);
  const scheduledCancellationEnd =
    query.data?.cancelAtEndOfCycle && query.data.currentBillingCycleEnd
      ? query.data.currentBillingCycleEnd
      : null;
  const now = useCurrentTime(Boolean(isTrial || scheduledCancellationEnd));
  const remaining =
    isTrial && trialEndsAt ? remainingTrialTime(trialEndsAt, now) : null;
  const expiredSyncAttempt = useRef<string | null>(null);
  const verificationDeadline =
    remaining?.kind === "expired" && trialEndsAt
      ? trialEndsAt
      : scheduledCancellationEnd &&
          new Date(scheduledCancellationEnd).getTime() <= now.getTime()
        ? scheduledCancellationEnd
        : null;

  useEffect(() => {
    if (
      verificationDeadline &&
      expiredSyncAttempt.current !== verificationDeadline &&
      !isFetching
    ) {
      expiredSyncAttempt.current = verificationDeadline;
      void refetch();
    }
  }, [isFetching, refetch, verificationDeadline]);

  if (!shop || (query.isPending && !query.data)) {
    return (
      <div
        aria-label="Loading subscription"
        className={styles.subscriptionSkeleton}
        role="status"
      >
        <span />
        <span />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className={styles.subscriptionBanner}>
        <s-banner
          heading="Subscription verification is unavailable"
          tone="critical"
        >
          <s-paragraph>{query.error.message}</s-paragraph>
          <s-button
            loading={query.isFetching ? true : undefined}
            onClick={() => void query.refetch()}
            slot="secondary-actions"
            variant="secondary"
          >
            Try again
          </s-button>
        </s-banner>
      </div>
    );
  }

  if (!isTrial || !query.data?.trialEndsAt || !remaining) {
    return null;
  }

  return (
    <div className={styles.subscriptionBanner}>
      <s-banner heading="Your free trial is active" tone="info">
        <s-stack gap="small">
          <s-paragraph>{remainingTrialMessage(remaining)}</s-paragraph>
          <s-paragraph color="subdued">
            Your trial ends on {formatSubscriptionDate(query.data.trialEndsAt)}.
          </s-paragraph>
        </s-stack>
      </s-banner>
    </div>
  );
}

export function SubscriptionPanel({
  initialSubscription,
  planSelectionUrl,
  shop,
}: SubscriptionStatusProps) {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const query = useSubscription(shop, initialSubscription);
  const planSyncAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (!shop || planSyncAttempt.current === shop) return;
    planSyncAttempt.current = shop;
    void forceSyncSubscription()
      .then((subscription) => {
        queryClient.setQueryData(subscriptionKeys.detail(shop), subscription);
      })
      .catch(() => {
        planSyncAttempt.current = null;
      });
  }, [queryClient, shop]);
  const cancellation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: async (subscription) => {
      if (shop) {
        queryClient.setQueryData(subscriptionKeys.detail(shop), subscription);
        await queryClient.invalidateQueries({
          queryKey: subscriptionKeys.detail(shop),
          refetchType: "none",
        });
      }
      const end = subscription.currentBillingCycleEnd;
      shopify.toast.show(
        end
          ? `Your subscription has been canceled and will remain active until ${formatSubscriptionDate(end)}.`
          : "Your subscription has been canceled.",
      );
    },
  });

  if (!shop || (query.isPending && !query.data)) {
    return (
      <div className={styles.planPanel}>
        <div
          aria-label="Loading plan"
          className={styles.planSkeleton}
          role="status"
        />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className={styles.planPanel}>
        <s-banner heading="Plan details couldn't be loaded" tone="critical">
          <s-paragraph>
            {query.error?.message ?? "Your subscription could not be verified."}
          </s-paragraph>
          <s-button
            loading={query.isFetching ? true : undefined}
            onClick={() => void query.refetch()}
            slot="secondary-actions"
            variant="secondary"
          >
            Try again
          </s-button>
        </s-banner>
      </div>
    );
  }

  const cycleEnd = query.data.currentBillingCycleEnd;
  const canCancel =
    query.data.status === "ACTIVE" &&
    query.data.canUseApp &&
    !query.data.cancelAtEndOfCycle &&
    Boolean(cycleEnd && new Date(cycleEnd).getTime() > Date.now());
  const statusLabel =
    query.data.status === "TRIAL"
      ? "Free trial"
      : query.data.status === "ACTIVE" && query.data.cancelAtEndOfCycle
        ? "Cancellation scheduled"
        : query.data.status === "ACTIVE"
          ? "Active"
          : "No active plan";

  return (
    <div className={styles.planPanel}>
      {!query.data.canUseApp ? (
        <InactivePlanBanner planSelectionUrl={planSelectionUrl} />
      ) : null}
      <s-section heading="Subscription">
        <dl className={styles.descriptionList}>
          <div className={styles.descriptionRow}>
            <dt>Status</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div className={styles.descriptionRow}>
            <dt>Plan</dt>
            <dd>{query.data.planHandle ?? "Unavailable"}</dd>
          </div>
          <div className={styles.descriptionRow}>
            <dt>Billing period</dt>
            <dd>
              {query.data.billingPeriod === "EVERY_30_DAYS"
                ? "Monthly"
                : query.data.billingPeriod === "ANNUAL"
                  ? "Yearly"
                  : (query.data.billingPeriod ?? "Unavailable")}
            </dd>
          </div>
          {query.data.trialEndsAt ? (
            <div className={styles.descriptionRow}>
              <dt>Trial ends</dt>
              <dd>{formatSubscriptionDate(query.data.trialEndsAt)}</dd>
            </div>
          ) : null}
          {query.data.currentBillingCycleEnd ? (
            <div className={styles.descriptionRow}>
              <dt>
                {query.data.cancelAtEndOfCycle ? "Active until" : "Renews on"}
              </dt>
              <dd>
                {formatSubscriptionDate(query.data.currentBillingCycleEnd)}
              </dd>
            </div>
          ) : null}
        </dl>
        {query.data.cancelAtEndOfCycle ? (
          <s-banner heading="Cancellation scheduled" tone="warning">
            Your plan remains active
            {cycleEnd ? ` until ${formatSubscriptionDate(cycleEnd)}` : ""}. You
            will not be charged again.
          </s-banner>
        ) : null}
        {cancellation.isError ? (
          <s-banner heading="Cancellation failed" tone="critical">
            {cancellation.error.message}
          </s-banner>
        ) : null}
        {canCancel && cycleEnd ? (
          <s-button
            command="--show"
            commandFor={CANCEL_SUBSCRIPTION_MODAL_ID}
            disabled={cancellation.isPending ? true : undefined}
            tone="critical"
            variant="secondary"
          >
            Cancel subscription
          </s-button>
        ) : query.data.cancelAtEndOfCycle && cycleEnd && planSelectionUrl ? (
          <s-button
            href={planSelectionUrl}
            target="_top"
            variant="primary"
          >
            Reactivate subscription
          </s-button>
        ) : query.data.cancelAtEndOfCycle && cycleEnd ? (
          <s-button disabled variant="secondary">
            Cancels on {formatSubscriptionDate(cycleEnd)}
          </s-button>
        ) : null}
      </s-section>
      {canCancel && cycleEnd ? (
        <CancelSubscriptionModal
          billingCycleEnd={cycleEnd}
          isCanceling={cancellation.isPending}
          onConfirm={() => cancellation.mutate()}
        />
      ) : null}
    </div>
  );
}
