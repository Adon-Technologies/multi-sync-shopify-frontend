import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import {
  FeedBackendError,
  requestStoreUninstallCleanup,
} from "../services/feed-backend.server";
import { deleteShopifySessionsForShop } from "../services/shopify-session-cleanup";
import {
  getCurrentStoreUninstallMarker,
  markStoreUninstalled,
} from "../services/store.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  const triggeredAtHeader = request.headers.get("x-shopify-triggered-at");
  const triggeredAtValue = triggeredAtHeader
    ? new Date(triggeredAtHeader)
    : new Date();
  const uninstalledAt = Number.isFinite(triggeredAtValue.getTime())
    ? triggeredAtValue
    : new Date();

  console.log(`Received ${topic} webhook for ${shop}`);

  // authenticate.webhook verifies Shopify's HMAC before this handler runs.
  // Mark the exact Shopify uninstall event before cleanup. A delayed webhook
  // from an older installation cannot overwrite a newer reinstall because the
  // update is conditional on installedAt being no newer than this event.
  const marked = await markStoreUninstalled(shop, uninstalledAt);
  if (marked.count === 0) {
    console.info(`Ignored stale ${topic} webhook for ${shop}`);
    return new Response();
  }

  // The backend removes every GCS feed object and only the explicitly scoped
  // store data while this uninstall marker is still current.
  try {
    await requestStoreUninstallCleanup(
      shop,
      uninstalledAt,
      session?.accessToken,
    );
  } catch (error) {
    console.error(`Uninstall cleanup failed for ${shop}`, {
      category: error instanceof Error ? error.name : "UNKNOWN",
      message:
        error instanceof Error ? error.message : "Unknown cleanup error",
      status: error instanceof FeedBackendError ? error.status : undefined,
    });
    // A non-2xx response asks Shopify to retry this idempotent webhook.
    return new Response("Store cleanup is temporarily unavailable.", {
      status: 503,
    });
  }

  // Do not delete sessions created by a reinstall that completed while the
  // backend cleanup was running.
  const currentMarker = await getCurrentStoreUninstallMarker(shop);
  if (
    currentMarker?.uninstalledAt?.getTime() === uninstalledAt.getTime()
  ) {
    await deleteShopifySessionsForShop(shop, sessionStorage);
  }

  return new Response();
};
