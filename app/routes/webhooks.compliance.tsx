import type { ActionFunctionArgs } from "react-router";

import { authenticate, sessionStorage } from "../shopify.server";
import {
  FeedBackendError,
  requestStoreUninstallCleanup,
} from "../services/feed-backend.server";
import { deleteShopifySessionsForShop } from "../services/shopify-session-cleanup";
import { markStoreUninstalled } from "../services/store.server";

/**
 * Multi Sync doesn't request customer or order scopes and doesn't persist
 * customer-level records. Customer access/redaction requests therefore only
 * need an authenticated acknowledgement.
 *
 * SHOP_REDACT arrives after an uninstall. Repeat the idempotent uninstall
 * cleanup so a previously interrupted cleanup cannot leave feed/configuration
 * data or GCS objects behind.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.info("[privacy] compliance webhook received", { shop, topic });

  if (topic !== "SHOP_REDACT") {
    return new Response();
  }

  try {
    await requestStoreUninstallCleanup(shop);
    await markStoreUninstalled(shop);
    await deleteShopifySessionsForShop(shop, sessionStorage);
  } catch (error) {
    console.error("[privacy] shop redaction cleanup failed", {
      category: error instanceof Error ? error.name : "UNKNOWN",
      shop,
      status: error instanceof FeedBackendError ? error.status : undefined,
    });
    // Shopify retries non-2xx deliveries. The cleanup path is idempotent.
    return new Response("Shop redaction is temporarily unavailable.", {
      status: 503,
    });
  }

  return new Response();
};
