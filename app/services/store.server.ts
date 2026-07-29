import prisma from "../db.server";
import {
  buildInstalledStoreUpdate,
  buildStoreTokenUpdate,
  buildUninstalledStoreUpdate,
  normalizeShopDomain,
} from "./store-lifecycle";

interface StoreSession {
  accessToken?: string;
  expires?: Date;
  refreshToken?: string;
  refreshTokenExpires?: Date;
  shop: string;
}

export async function upsertInstalledStore(session: StoreSession) {
  const shopDomain = normalizeShopDomain(session.shop);
  const existing = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      accessToken: true,
      accessTokenExpiresAt: true,
      refreshToken: true,
      refreshTokenExpiresAt: true,
      status: true,
    },
  });
  const tokenUpdate = buildStoreTokenUpdate(existing ?? null, session);
  const accessToken =
    tokenUpdate.accessToken ??
    existing?.accessToken ??
    session.accessToken?.trim();

  if (!accessToken) {
    throw new Error(`No Shopify access token is available for ${shopDomain}.`);
  }

  return prisma.store.upsert({
    where: { shopDomain },
    create: {
      accessToken,
      ...tokenUpdate,
      shopDomain,
      status: "INSTALLED",
    },
    update: {
      ...buildInstalledStoreUpdate(existing?.status ?? null, accessToken),
      ...tokenUpdate,
    },
  });
}

export async function markStoreUninstalled(
  shop: string,
  uninstalledAt = new Date(),
) {
  return prisma.store.updateMany({
    where: { shopDomain: normalizeShopDomain(shop) },
    data: buildUninstalledStoreUpdate(uninstalledAt),
  });
}
