export type SubscriptionStatus =
  | "UNKNOWN"
  | "NO_SUBSCRIPTION"
  | "TRIAL"
  | "ACTIVE"
  | "CANCELED"
  | "FROZEN"
  | "EXPIRED";

export interface SubscriptionView {
  billingPeriod: string | null;
  cancelAtEndOfCycle: boolean;
  canUseApp: boolean;
  currentBillingCycleEnd: string | null;
  currentBillingCycleStart: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  planHandle: string | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
}

export function cleanPlanSelectionReturnPath(requestUrl: string) {
  const url = new URL(requestUrl);
  url.searchParams.delete("plan_handle");
  url.searchParams.delete("charge_id");
  return `${url.pathname}${url.search}`;
}

export type RemainingTrialTime =
  | { kind: "days"; value: number }
  | { kind: "hours"; value: number }
  | { kind: "minutes"; value: number }
  | { kind: "expired"; value: 0 };

export function remainingTrialTime(
  trialEndsAt: string,
  now = new Date(),
): RemainingTrialTime {
  const end = new Date(trialEndsAt);
  const milliseconds = end.getTime() - now.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return { kind: "expired", value: 0 };
  }

  const hour = 60 * 60 * 1_000;
  if (milliseconds > 48 * hour) {
    return {
      kind: "days",
      value: Math.ceil(milliseconds / (24 * hour)),
    };
  }
  if (milliseconds >= hour) {
    return { kind: "hours", value: Math.ceil(milliseconds / hour) };
  }
  return {
    kind: "minutes",
    value: Math.max(1, Math.ceil(milliseconds / (60 * 1_000))),
  };
}

export function remainingTrialMessage(value: RemainingTrialTime) {
  if (value.kind === "expired") {
    return "Your free trial is being refreshed.";
  }
  const unit =
    value.value === 1 ? value.kind.slice(0, -1) : value.kind;
  return `You have ${value.value} ${unit} remaining in your free trial.`;
}
