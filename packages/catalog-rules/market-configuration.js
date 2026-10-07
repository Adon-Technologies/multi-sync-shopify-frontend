// Deliberate allowlist: new Configuration fields require an explicit decision.
export const MARKET_CONFIGURATION_SECTIONS = Object.freeze({
  submission: ["productSubmissionMode", "includedCollectionIds"],
  collections: ["excludedCollections"],
  titles: ["excludedTitleTerms"],
  titleCleanup: ["excludedTitleAttributes"],
  tags: ["excludedProductTags"],
  google: [
    "showSalePriceInGoogleFeed",
    "useProductImageAsMainImage",
    "includeShippingWeightInGoogleFeed",
    "excludeOutOfStockItems",
  ],
  inventory: [
    "ignoreShopifyInventoryInGoogleFeed",
    "inventorySourceMode",
    "selectedInventoryLocationIds",
  ],
  urls: ["disableUtmParameters", "checkoutLinkMode"],
});
export const MARKET_CONFIGURATION_FIELDS = Object.freeze(
  Object.values(MARKET_CONFIGURATION_SECTIONS).flat(),
);
export class MarketConfigurationError extends Error {}

export function pickMarketConfiguration(primary) {
  if (!primary || typeof primary !== "object" || Array.isArray(primary))
    return {};
  return Object.fromEntries(
    MARKET_CONFIGURATION_FIELDS.filter((key) => primary[key] !== undefined).map(
      (key) => [key, structuredClone(primary[key])],
    ),
  );
}

export function validateMarketConfiguration(value, { complete = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MarketConfigurationError(
      "Choose valid custom configuration settings.",
    );
  for (const key of Object.keys(value)) {
    if (!MARKET_CONFIGURATION_FIELDS.includes(key))
      throw new MarketConfigurationError(
        `This setting cannot be customized: ${key}.`,
      );
  }
  const enums = {
    productSubmissionMode: ["ALL_PRODUCTS", "SELECTED_COLLECTIONS"],
    inventorySourceMode: ["ALL_LOCATIONS", "SELECTED_LOCATIONS"],
    checkoutLinkMode: ["DISABLED", "CART", "CHECKOUT"],
  };
  const arrays = {
    includedCollectionIds: [1000, /^gid:\/\/shopify\/Collection\/\d+$/],
    selectedInventoryLocationIds: [250, /^gid:\/\/shopify\/Location\/\d+$/],
    excludedTitleTerms: [100, null],
    excludedTitleAttributes: [100, null],
    excludedProductTags: [100, null],
  };
  for (const key of MARKET_CONFIGURATION_FIELDS) {
    const entry = value[key];
    if (entry === undefined && !complete) continue;
    let valid;
    if (enums[key]) valid = enums[key].includes(entry);
    else if (arrays[key]) {
      const [limit, pattern] = arrays[key];
      valid =
        Array.isArray(entry) &&
        entry.length <= limit &&
        entry.every(
          (item) =>
            typeof item === "string" &&
            item.trim().length > 0 &&
            item.length <=
              (pattern ||
              key === "excludedProductTags" ||
              key === "excludedTitleAttributes"
                ? 255
                : 100) &&
            (!pattern || pattern.test(item)),
        ) &&
        new Set(entry).size === entry.length;
    } else if (key === "excludedCollections") {
      valid =
        Array.isArray(entry) &&
        entry.length <= 100 &&
        entry.every(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof item.id === "string" &&
            /^gid:\/\/shopify\/Collection\/\d+$/.test(item.id) &&
            typeof item.title === "string" &&
            item.title.trim().length > 0 &&
            item.title.length <= 255,
        ) &&
        new Set(entry.map((item) => item.id)).size === entry.length;
    } else valid = typeof entry === "boolean";
    if (!valid)
      throw new MarketConfigurationError(`Choose a valid value for ${key}.`);
  }
  if (
    value.productSubmissionMode === "SELECTED_COLLECTIONS" &&
    !value.includedCollectionIds?.length
  )
    throw new MarketConfigurationError("Select at least one collection.");
  const result = pickMarketConfiguration(value);
  if (result.excludedCollections)
    result.excludedCollections = result.excludedCollections.map(
      ({ id, title }) => ({ id, title }),
    );
  return result;
}

export function resolveEffectiveFeedConfiguration(primary, feed) {
  if (
    feed.feedType !== "ADDITIONAL" ||
    feed.customConfigurationEnabled !== true ||
    !feed.customConfiguration
  )
    return primary;
  // Ignore forbidden/stale keys even in previously stored JSON. Missing future
  // overridable fields follow Primary until explicitly initialized and saved.
  return { ...primary, ...pickMarketConfiguration(feed.customConfiguration) };
}

export function primaryChangeAffectsFeed(previous, next, feed) {
  if (!previous) return true;
  const before = resolveEffectiveFeedConfiguration(previous, feed);
  const after = resolveEffectiveFeedConfiguration(next, feed);
  return Object.keys({ ...before, ...after }).some(
    (key) =>
      !["productTypes", "alertsEmail"].includes(key) &&
      // Existing Additional ID codes are frozen separately when Primary changes.
      !(
        ["countryCode", "disablePrimaryCurrencyParameter"].includes(key) &&
        feed.feedType === "ADDITIONAL"
      ) &&
      JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
