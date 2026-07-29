export type StoreLifecycleStatus = "INSTALLED" | "UNINSTALLED";

export interface StoredShopifyTokenState {
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  status: StoreLifecycleStatus | null;
}

export interface ShopifyTokenSession {
  accessToken?: string;
  expires?: Date;
  refreshToken?: string;
  refreshTokenExpires?: Date;
}

export interface StoreTokenUpdate {
  accessToken?: string;
  accessTokenExpiresAt?: Date | null;
  refreshToken?: string;
  refreshTokenExpiresAt?: Date | null;
  tokenRefreshLockId?: null;
  tokenRefreshLockedAt?: null;
}

export function normalizeShopDomain(shop: string) {
  return shop.normalize("NFKC").trim().toLowerCase();
}

function validDate(value: unknown) {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : null;
}

export function buildStoreTokenUpdate(
  existing: StoredShopifyTokenState | null,
  session: ShopifyTokenSession,
): StoreTokenUpdate {
  const sessionAccessToken = session.accessToken?.trim() || null;
  const sessionAccessExpiresAt = validDate(session.expires);
  const existingAccessExpiresAt = validDate(
    existing?.accessTokenExpiresAt,
  );
  const isReinstall = existing?.status === "UNINSTALLED";
  const shouldAdoptAccessToken =
    Boolean(sessionAccessToken) &&
    (isReinstall ||
      !existing?.accessToken ||
      !existingAccessExpiresAt ||
      (Boolean(sessionAccessExpiresAt) &&
        sessionAccessExpiresAt!.getTime() >=
          existingAccessExpiresAt.getTime()));

  if (!shouldAdoptAccessToken || !sessionAccessToken) {
    return {};
  }

  const update: StoreTokenUpdate & { accessToken: string } = {
    accessToken: sessionAccessToken,
    accessTokenExpiresAt: sessionAccessExpiresAt,
    tokenRefreshLockId: null,
    tokenRefreshLockedAt: null,
  };
  const sessionRefreshToken = session.refreshToken?.trim() || null;

  if (sessionRefreshToken) {
    update.refreshToken = sessionRefreshToken;
    update.refreshTokenExpiresAt = validDate(session.refreshTokenExpires);
  }

  return update;
}

export function buildInstalledStoreUpdate(
  previousStatus: StoreLifecycleStatus | null,
  accessToken: string,
  installedAt = new Date(),
) {
  return {
    accessToken,
    status: "INSTALLED" as const,
    uninstalledAt: null,
    ...(previousStatus === "UNINSTALLED" ? { installedAt } : {}),
  };
}

export function buildUninstalledStoreUpdate(uninstalledAt = new Date()) {
  return {
    accessToken: null,
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    status: "UNINSTALLED" as const,
    tokenRefreshLockId: null,
    tokenRefreshLockedAt: null,
    uninstalledAt,
  };
}
