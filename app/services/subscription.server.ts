import type { SubscriptionView } from "../billing/types";
import { requestFeedBackend } from "./feed-backend.server";

interface BillingSession {
  accessToken?: string;
  expires?: Date;
  refreshToken?: string;
  refreshTokenExpires?: Date;
  shop: string;
}

interface SubscriptionResponse {
  ok: true;
  subscription: SubscriptionView;
}

interface PlanSelectionResponse {
  ok: true;
  url: string;
}

export async function getSubscriptionForSession(
  session: BillingSession,
  options: { force?: boolean } = {},
) {
  const result = await requestFeedBackend<SubscriptionResponse>(
    session,
    options.force ? "POST" : "GET",
    options.force
      ? "/api/subscription/sync"
      : "/api/subscription",
  );
  return result.subscription;
}

export async function getPlanSelectionForSession(
  session: BillingSession,
) {
  return requestFeedBackend<PlanSelectionResponse>(
    session,
    "GET",
    "/api/subscription/plan-selection-url",
  );
}
