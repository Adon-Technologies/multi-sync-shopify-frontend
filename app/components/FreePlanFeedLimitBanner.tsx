import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { SubscriptionView } from "../billing/types";
import {
  additionalFeedsQueryOptions,
  primaryFeedQueryOptions,
  type FeedQueryScope,
} from "../services/feed-query";
import styles from "../styles/dashboard.module.css";

interface FreePlanFeedLimitBannerProps {
  active: boolean;
  scope: FeedQueryScope;
  statistics: Promise<{ totalProducts: number }>;
  subscription: SubscriptionView | null;
}

type NoticeState = "unseen" | "visible" | "dismissed";

export function FreePlanFeedLimitBanner(props: FreePlanFeedLimitBannerProps) {
  // Isolate both the dismissal and observed generation when the store changes.
  return <StoreFeedLimitBanner key={props.scope.shop} {...props} />;
}

function StoreFeedLimitBanner({
  active,
  scope,
  statistics,
  subscription,
}: FreePlanFeedLimitBannerProps) {
  const storageKey = `multi-sync:${scope.shop}:free-feed-limit-notice:v1`;
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [generationObserved, setGenerationObserved] = useState(false);
  const bannerRef = useRef<HTMLElementTagNameMap["s-banner"]>(null);
  // Dashboard and Feeds already load/poll these shared queries. Observe their
  // results without adding requests or a second generation poller.
  const primaryQuery = useQuery({
    ...primaryFeedQueryOptions(scope),
    enabled: false,
  });
  const additionalQuery = useQuery({
    ...additionalFeedsQueryOptions(scope),
    enabled: false,
  });
  const primary = primaryQuery.data?.ok ? primaryQuery.data : null;
  const additional = additionalQuery.data?.ok ? additionalQuery.data : null;
  const feeds = [
    primary?.feed,
    ...(additional?.feeds.map(({ feed }) => feed) ?? []),
  ];
  const isGenerating = Boolean(
    primary?.activeGeneration ||
    additional?.activeGeneration ||
    feeds.some(
      (feed) => feed?.status === "QUEUED" || feed?.status === "PROCESSING",
    ),
  );
  const productCount = Math.max(
    catalogCount ?? 0,
    ...feeds.map((feed) => feed?.totalProducts ?? 0),
  );
  const limit = subscription?.entitlements?.productLimit;
  const isFree =
    subscription?.plan === "FREE" && subscription.canUseApp && limit != null;

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      // Dismissal still works for this app visit if browser storage is blocked.
    }
    setNotice(
      stored === "dismissed" || stored === "visible" ? stored : "unseen",
    );
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue === "dismissed") {
        setNotice("dismissed");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  useEffect(() => {
    let current = true;
    setCatalogCount(null);
    void statistics.then(
      (result) => {
        if (current) setCatalogCount(result.totalProducts);
      },
      () => {
        /* Generation progress can still supply the catalog count. */
      },
    );
    return () => {
      current = false;
    };
  }, [statistics]);

  useEffect(() => {
    if (!isFree) setGenerationObserved(false);
    else if (isGenerating) setGenerationObserved(true);
  }, [isFree, isGenerating]);

  useEffect(() => {
    if (
      notice !== "unseen" ||
      !isFree ||
      !generationObserved ||
      productCount <= limit!
    )
      return;
    setNotice("visible");
    try {
      window.localStorage.setItem(storageKey, "visible");
    } catch {
      /* Keep the notice in memory when browser storage is blocked. */
    }
  }, [generationObserved, isFree, limit, notice, productCount, storageKey]);

  const visible =
    active && isFree && notice === "visible" && productCount > limit!;
  useEffect(() => {
    const banner = bannerRef.current;
    if (!visible || !banner) return;
    const dismiss = () => {
      setNotice("dismissed");
      try {
        window.localStorage.setItem(storageKey, "dismissed");
      } catch {
        /* The shared component still remembers dismissal for this visit. */
      }
    };
    banner.addEventListener("dismiss", dismiss);
    return () => banner.removeEventListener("dismiss", dismiss);
  }, [storageKey, visible]);

  if (!visible) return null;
  return (
    <div className={styles.feedLimitNotice}>
      <s-banner
        ref={bannerRef}
        dismissible
        heading={`Your Free plan includes up to ${limit} products per XML feed`}
        tone="info"
      >
        <s-paragraph>
          Your store has more than {limit} products. Each XML feed can contain
          up to {limit} eligible products and their eligible variants on the
          Free plan.
        </s-paragraph>
      </s-banner>
    </div>
  );
}
