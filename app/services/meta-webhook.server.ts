import { createHash } from "node:crypto";
import prisma from "../db.server";
import { requestFeedBackend } from "./feed-backend.server";

export const META_CHANGE_TOPICS = new Set([
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
  "INVENTORY_LEVELS_CONNECT",
  "INVENTORY_LEVELS_DISCONNECT",
  "INVENTORY_ITEMS_UPDATE",
  "SHOP_UPDATE",
  "COLLECTIONS_CREATE",
  "COLLECTIONS_UPDATE",
  "COLLECTIONS_DELETE",
]);
export async function notifyMetaCatalogChange(shop: string, topic: string) {
  if (!META_CHANGE_TOPICS.has(topic)) return;
  const store = await prisma.store.findUnique({
    where: { shopDomain: shop },
    select: { accessToken: true, status: true, accessStatus: true },
  });
  if (
    !store?.accessToken ||
    store.status !== "INSTALLED" ||
    store.accessStatus === "SUSPENDED"
  )
    return;
  // The Shopify-verified event only marks the connection dirty. Its payload is
  // never trusted as catalog data; the worker rereads Shopify with store credentials.
  await requestFeedBackend(
    { shop, accessToken: store.accessToken },
    "POST",
    "/api/integrations/meta",
    {
      intent: "sync-change",
      actorId: createHash("sha256")
        .update(`${shop}:webhook:${topic}`)
        .digest("hex"),
    },
    { readOnlyStore: true, signal: AbortSignal.timeout(3500) },
  );
}
