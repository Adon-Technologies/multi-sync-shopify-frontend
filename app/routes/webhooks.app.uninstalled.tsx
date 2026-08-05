import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import {
  FeedBackendError,
  requestStoreUninstallCleanup,
} from "../services/feed-backend.server";
import { deleteShopifySessionsForShop } from "../services/shopify-session-cleanup";
import { markStoreUninstalled } from "../services/store.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // authenticate.webhook verifies Shopify's HMAC before this handler runs.
  // The backend first disables background work, removes every GCS feed object
  // for this shop, and deletes only the explicitly scoped store data.
  try {
    await requestStoreUninstallCleanup(shop, session?.accessToken);
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

  // Keep the Store record for lifecycle history, but invalidate its tokens.
  await markStoreUninstalled(shop);

  // Delete every offline and online session for this shop. This remains safe
  // when Shopify retries the webhook after the sessions were already removed.
  await deleteShopifySessionsForShop(shop, sessionStorage);

  return new Response();
};
