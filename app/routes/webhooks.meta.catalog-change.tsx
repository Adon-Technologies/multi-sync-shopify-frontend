import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { notifyMetaCatalogChange } from "../services/meta-webhook.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);
  try {
    await notifyMetaCatalogChange(shop, topic);
    return new Response(null, { status: 204 });
  } catch {
    // Shopify retries delivery if the durable request could not be persisted.
    return new Response(
      "Catalog update scheduling is temporarily unavailable.",
      { status: 503 },
    );
  }
}
