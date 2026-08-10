import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticateActiveAdmin(request);
  const requestUrl = new URL(request.url);
  const returnedFromPlanSelection = requestUrl.searchParams.has("plan_handle");
  const subscription = await getSubscriptionForSession(session, {
    force: returnedFromPlanSelection,
  });
  if (returnedFromPlanSelection) {
    throw redirect(cleanPlanSelectionReturnPath(request.url));
  }
  const initialTab = parseDashboardTab(requestUrl.searchParams.get("tab"));
  const planSelection = await getPlanSelectionForSession(session);

  return {
    // These promises start concurrently and stream independently. React
    // Router discards stale loader results after navigation or revalidation.
    storeInformation: subscription.canUseApp
      ? getStoreInformation(admin, session.shop)
      : Promise.resolve({ currency: null, domain: session.shop }),
    statistics: subscription.canUseApp
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
  } = useLoaderData<typeof loader>();
  const refreshFetcher = useFetcher<typeof action>();
  const isRefreshing = refreshFetcher.state !== "idle";
  const refresh = () => refreshFetcher.submit(null, { method: "post" });

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
