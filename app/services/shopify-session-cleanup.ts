import { normalizeShopDomain } from "./store-lifecycle.ts";

interface StoredShopifySession {
  id: string;
}

export interface ShopifySessionCleanupStorage {
  deleteSessions(ids: string[]): Promise<boolean>;
  findSessionsByShop(shop: string): Promise<StoredShopifySession[]>;
}

export async function deleteShopifySessionsForShop(
  shop: string,
  storage: ShopifySessionCleanupStorage,
) {
  const normalizedShop = normalizeShopDomain(shop);
  const sessions = await storage.findSessionsByShop(normalizedShop);

  if (sessions.length === 0) return 0;

  await storage.deleteSessions(sessions.map(({ id }) => id));
  return sessions.length;
}
