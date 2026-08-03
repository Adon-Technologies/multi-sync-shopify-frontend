import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { requestStoreUninstallCleanup } from "../services/feed-backend.server";
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
    });
    // A non-2xx response asks Shopify to retry this idempotent webhook.
    return new Response("Store cleanup is temporarily unavailable.", {
      status: 503,
    });
  }

  // Keep the Store record for lifecycle history, but invalidate its tokens.
  await markStoreUninstalled(shop);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
