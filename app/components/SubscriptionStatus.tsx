import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  remainingTrialMessage,
  remainingTrialTime,
} from "../billing/types";
import { subscriptionQueryOptions } from "../services/subscription-query";
import styles from "../styles/dashboard.module.css";

interface SubscriptionStatusProps {
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function useSubscription(shop: string | null) {
  return useQuery({
    ...subscriptionQueryOptions(shop ?? "pending-shop"),
    enabled: Boolean(shop),
  });
}

export function SubscriptionBanner({
  shop,
}: SubscriptionStatusProps) {
  const query = useSubscription(shop);
  const refetch = query.refetch;
  const trialEndsAt = query.data?.trialEndsAt ?? null;
  const isFetching = query.isFetching;
  const isTrial =
    query.data?.status === "TRIAL" && Boolean(trialEndsAt);
  const now = useCurrentTime(isTrial);
  const remaining =
    isTrial && trialEndsAt
      ? remainingTrialTime(trialEndsAt, now)
      : null;
  const expiredSyncAttempt = useRef<string | null>(null);

  useEffect(() => {
    if (
      remaining?.kind === "expired" &&
      trialEndsAt &&
      expiredSyncAttempt.current !== trialEndsAt &&
      !isFetching
    ) {
      expiredSyncAttempt.current = trialEndsAt;
      void refetch();
    }
  }, [
    trialEndsAt,
    isFetching,
    refetch,
    remaining?.kind,
  ]);

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
        <s-banner heading="Subscription verification is unavailable" tone="critical">
          <s-paragraph>
            {query.error.message}
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

  if (!isTrial || !query.data?.trialEndsAt || !remaining) {
    return null;
  }

  return (
    <div className={styles.subscriptionBanner}>
      <s-banner heading="Your free trial is active" tone="info">
        <s-stack gap="small">
          <s-paragraph>{remainingTrialMessage(remaining)}</s-paragraph>
          <s-paragraph color="subdued">
            Your trial ends on {formatDate(query.data.trialEndsAt)}.
          </s-paragraph>
        </s-stack>
      </s-banner>
    </div>
  );
}

export function SubscriptionPanel({
  shop,
}: SubscriptionStatusProps) {
  const query = useSubscription(shop);

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
            {query.error?.message ??
              "Your subscription could not be verified."}
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

  return (
    <div className={styles.planPanel}>
      <s-section heading="Subscription">
        <dl className={styles.descriptionList}>
          <div className={styles.descriptionRow}>
            <dt>Status</dt>
            <dd>{query.data.status === "TRIAL" ? "Free trial" : "Active"}</dd>
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
                  : query.data.billingPeriod ?? "Unavailable"}
            </dd>
          </div>
          {query.data.trialEndsAt ? (
            <div className={styles.descriptionRow}>
              <dt>Trial ends</dt>
              <dd>{formatDate(query.data.trialEndsAt)}</dd>
            </div>
          ) : null}
          {query.data.currentBillingCycleEnd ? (
            <div className={styles.descriptionRow}>
              <dt>Current cycle ends</dt>
              <dd>{formatDate(query.data.currentBillingCycleEnd)}</dd>
            </div>
          ) : null}
        </dl>
        {query.data.cancelAtEndOfCycle ? (
          <s-banner heading="Cancellation scheduled" tone="warning">
            Access remains active through the current billing cycle.
          </s-banner>
        ) : null}
      </s-section>
    </div>
  );
}
