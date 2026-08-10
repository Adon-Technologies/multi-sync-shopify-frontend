import { queryOptions } from "@tanstack/react-query";

import type { SubscriptionView } from "../billing/types";

interface SubscriptionResponse {
  error?: string;
  ok: boolean;
  subscription?: SubscriptionView;
}

export class SubscriptionQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionQueryError";
  }
}

async function requestSubscription() {
  const response = await fetch("/app/subscription", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const payload = (await response
    .json()
    .catch(() => null)) as SubscriptionResponse | null;
  if (!response.ok || !payload?.ok || !payload.subscription) {
    throw new SubscriptionQueryError(
      payload?.error || "Your subscription could not be verified. Try again.",
    );
  }
  return payload.subscription;
}

export async function cancelSubscription() {
  const response = await fetch("/app/subscription/cancel", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "POST",
  });
  const payload = (await response
    .json()
    .catch(() => null)) as SubscriptionResponse | null;
  if (!response.ok || !payload?.ok || !payload.subscription) {
    throw new SubscriptionQueryError(
      payload?.error || "Your subscription could not be canceled. Try again.",
    );
  }
  return payload.subscription;
}

export async function forceSyncSubscription() {
  const response = await fetch("/app/subscription", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "POST",
  });
  const payload = (await response
    .json()
    .catch(() => null)) as SubscriptionResponse | null;
  if (!response.ok || !payload?.ok || !payload.subscription) {
    throw new SubscriptionQueryError(
      payload?.error || "Your subscription could not be verified. Try again.",
    );
  }
  return payload.subscription;
}

export const subscriptionKeys = {
  all: ["subscription"] as const,
  detail: (shop: string) => ["subscription", shop] as const,
};

export function subscriptionQueryOptions(shop: string) {
  return queryOptions({
    queryKey: subscriptionKeys.detail(shop),
    queryFn: requestSubscription,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 4 * 60 * 1_000,
  });
}
