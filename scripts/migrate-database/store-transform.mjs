export const SOURCE_STORE_COLLECTION = "Store";
export const SOURCE_INSTALLER_COLLECTION = "InstallerShop";
export const SOURCE_ACCESS_COLLECTION = "ShopAccess";
export const TARGET_STORE_COLLECTION = "Store";

export const STORE_FIELDS_MIGRATED = Object.freeze([
  "shopDomain",
  "accessToken",
  "status",
  "accessStatus",
  "installedAt",
  "uninstalledAt",
  "createdAt",
  "updatedAt",
]);

export const STORE_FIELDS_DEFERRED = Object.freeze([
  "autoRefreshEnabled",
  "colorOptionName",
  "countryCode",
  "defaultAge",
  "defaultGender",
  "disableMainFeedCurrencyParameter",
  "disableUtmParameters",
  "email",
  "excludeOutOfStock",
  "excludedCollectionTitles",
  "excludedNames",
  "ignoreShopifyInventoryInFeed",
  "includeCheckoutLink",
  "includeShippingWeightInFeed",
  "inventorySourceMode",
  "nextRefreshAt",
  "refreshTimeLocal",
  "refreshTimezone",
  "selectedInventoryLocationIds",
  "sizeOptionName",
  "useProductImage",
]);

export function normalizeShopDomain(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : "";
}

export function isValidShopDomain(value) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value);
}

function validDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : null;
}

function latestDate(values, fallback) {
  const dates = values.filter(validDate);
  if (dates.length === 0) return fallback;

  return new Date(Math.max(...dates.map((value) => value.getTime())));
}

export function transformLegacyStore({
  includeAccessTokens = false,
  installerShop,
  migrationTime = new Date(),
  shopAccess,
  store,
}) {
  const shopDomain = normalizeShopDomain(store?.shopDomain);
  if (!isValidShopDomain(shopDomain)) {
    throw new Error(
      "shopDomain is missing or is not a valid myshopify.com domain",
    );
  }

  const safeMigrationTime = validDate(migrationTime) ?? new Date();
  const warnings = [];

  if (!installerShop) {
    warnings.push(
      "No matching InstallerShop document; defaulted status to INSTALLED and dates to migration time",
    );
  }
  if (!shopAccess) {
    warnings.push(
      "No matching ShopAccess document; defaulted accessStatus to ACTIVE",
    );
  }

  const sourceAccessToken =
    typeof store?.accessToken === "string" ? store.accessToken.trim() : "";
  const forcedUninstalledWithoutToken = sourceAccessToken.length === 0;
  const status =
    installerShop?.installed === false || forcedUninstalledWithoutToken
      ? "UNINSTALLED"
      : "INSTALLED";
  const accessStatus = shopAccess?.suspended === true ? "SUSPENDED" : "ACTIVE";
  const installedAt =
    validDate(installerShop?.lastInstallAt) ??
    validDate(installerShop?.firstInstallAt) ??
    safeMigrationTime;
  const createdAt = validDate(installerShop?.firstInstallAt) ?? installedAt;
  const uninstalledAt =
    status === "UNINSTALLED"
      ? (validDate(installerShop?.lastUninstallAt) ?? safeMigrationTime)
      : null;
  const updatedAt = latestDate(
    [
      installedAt,
      uninstalledAt,
      installerShop?.lastInstallAt,
      installerShop?.lastUninstallAt,
      shopAccess?.updatedAt,
    ],
    safeMigrationTime,
  );

  const copyAccessToken =
    includeAccessTokens &&
    status === "INSTALLED" &&
    sourceAccessToken.length > 0;

  if (forcedUninstalledWithoutToken) {
    warnings.push("No legacy access token; forced status to UNINSTALLED");
  }

  return {
    document: {
      shopDomain,
      accessStatus,
      accessToken: copyAccessToken ? sourceAccessToken : null,
      status,
      installedAt,
      createdAt,
      updatedAt,
      uninstalledAt,
      feedGenerationFeedId: null,
      feedGenerationLockedAt: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      tokenRefreshLockId: null,
      tokenRefreshLockedAt: null,
    },
    warnings,
  };
}
