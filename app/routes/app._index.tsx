import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { DashboardTabs, parseDashboardTab } from "../components/DashboardTabs";
import {
  getProductStatistics,
  getStoreInformation,
  invalidateDashboardCache,
  type ProductStatistics,
  type StoreInformation,
} from "../services/dashboard.server";
import {
  getPlanSelectionForSession,
  getSubscriptionForSession,
} from "../services/subscription.server";
import {
  authenticateActiveAdmin,
  authenticateSubscribedAdmin,
} from "../shopify.server";
import { cleanPlanSelectionReturnPath } from "../billing/types";

const pendingStatistics = new Promise<ProductStatistics>(() => undefined);
const pendingStoreInformation = new Promise<StoreInformation>(() => undefined);

function billingErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Your Shopify subscription could not be verified. Try again.";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticateActiveAdmin(request);
  const requestUrl = new URL(request.url);
  const returnedFromPlanSelection = requestUrl.searchParams.has("plan_handle");
  let subscription: Awaited<
    ReturnType<typeof getSubscriptionForSession>
  > | null = null;
  let subscriptionError: string | null = null;
  try {
    subscription = await getSubscriptionForSession(session, {
      force: returnedFromPlanSelection,
    });
  } catch (error) {
    subscriptionError = billingErrorMessage(error);
  }
  if (returnedFromPlanSelection) {
    throw redirect(cleanPlanSelectionReturnPath(request.url));
  }
  const initialTab = parseDashboardTab(requestUrl.searchParams.get("tab"));
  const planSelection = await getPlanSelectionForSession(session).catch(
    () => null,
  );

  return {
    // These promises start concurrently and stream independently. React
    // Router discards stale loader results after navigation or revalidation.
    storeInformation: subscription?.canUseApp
      ? getStoreInformation(admin, session.shop)
      : Promise.resolve({ currency: null, domain: session.shop }),
    statistics: subscription?.canUseApp
      ? getProductStatistics(admin, session.shop)
      : Promise.resolve({
          generatedAt: new Date().toISOString(),
          publishedProducts: 0,
          publishedProductVariants: 0,
          totalProducts: 0,
          unpublishedProducts: 0,
        }),
    diagnosticsScope: {
      shop: session.shop,
      sessionId: session.id,
    },
    feedScope: {
      locale: null,
      shop: session.shop,
      sessionId: session.id,
    },
    initialTab,
    planSelectionUrl: planSelection?.url ?? null,
    subscription,
    subscriptionError,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateSubscribedAdmin(request);
  invalidateDashboardCache(session.shop);

  return { ok: true };
};

export default function Index() {
  const {
    diagnosticsScope,
    feedScope,
    initialTab,
    planSelectionUrl,
    statistics,
    storeInformation,
    subscription,
    subscriptionError,
  } = useLoaderData<typeof loader>();
  const refreshFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const isRefreshing = refreshFetcher.state !== "idle";
  const refresh = () => refreshFetcher.submit(null, { method: "post" });

  if (subscriptionError) {
    return (
      <s-page>
        <s-section heading="Multi Sync Google Feed">
          <s-banner
            heading="Subscription verification is temporarily unavailable"
            tone="critical"
          >
            <s-paragraph>{subscriptionError}</s-paragraph>
            <s-paragraph color="subdued">
              Your existing subscription has not been changed. Retry the
              verification to continue.
            </s-paragraph>
            <s-button
              loading={revalidator.state !== "idle" ? true : undefined}
              onClick={() => revalidator.revalidate()}
              slot="secondary-actions"
              variant="secondary"
            >
              Try again
            </s-button>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  return (
    <DashboardTabs
      diagnosticsScope={diagnosticsScope}
      feedScope={feedScope}
      initialTab={initialTab}
      initialSubscription={subscription}
      isRefreshing={isRefreshing}
      onRefresh={refresh}
      planSelectionUrl={planSelectionUrl}
      statistics={statistics}
      storeInformation={storeInformation}
    />
  );
}

export function HydrateFallback() {
  return (
    <DashboardTabs
      diagnosticsScope={null}
      feedScope={null}
      initialSubscription={null}
      isRefreshing={false}
      onRefresh={() => undefined}
      planSelectionUrl={null}
      statistics={pendingStatistics}
      storeInformation={pendingStoreInformation}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
