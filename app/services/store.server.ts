import prisma from "../db.server";
import {
  buildInstalledStoreUpdate,
  buildStoreTokenUpdate,
  buildUninstalledStoreUpdate,
  canSyncStoreFromSession,
  normalizeShopDomain,
} from "./store-lifecycle";

interface StoreSession {
  accessToken?: string;
  expires?: Date;
  refreshToken?: string;
  refreshTokenExpires?: Date;
  shop: string;
}

export interface UpsertInstalledStoreOptions {
  allowReinstall?: boolean;
}

export async function upsertInstalledStore(
  session: StoreSession,
  options: UpsertInstalledStoreOptions = {},
) {
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
  if (
    !canSyncStoreFromSession(
      existing?.status ?? null,
      options.allowReinstall,
    )
  ) {
    throw new Error(
      `Store ${shopDomain} must complete Shopify authentication before it can be reinstalled.`,
    );
  }
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
    where: {
      shopDomain: normalizeShopDomain(shop),
      OR: [
        {
          installedAt: { lte: uninstalledAt },
          status: "INSTALLED",
        },
        {
          status: "UNINSTALLED",
          uninstalledAt: { lte: uninstalledAt },
        },
      ],
    },
    data: buildUninstalledStoreUpdate(uninstalledAt),
  });
}

export async function getCurrentStoreUninstallMarker(shop: string) {
  return prisma.store.findFirst({
    where: {
      shopDomain: normalizeShopDomain(shop),
      status: "UNINSTALLED",
      uninstalledAt: { not: null },
    },
    select: { uninstalledAt: true },
  });
}
