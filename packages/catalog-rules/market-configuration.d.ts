export const MARKET_CONFIGURATION_SECTIONS: Readonly<
  Record<
    | "submission"
    | "collections"
    | "titles"
    | "titleCleanup"
    | "tags"
    | "google"
    | "inventory"
    | "urls",
    readonly string[]
  >
>;
export const MARKET_CONFIGURATION_FIELDS: readonly string[];
export class MarketConfigurationError extends Error {}
export interface MarketConfiguration {
  productSubmissionMode: "ALL_PRODUCTS" | "SELECTED_COLLECTIONS";
  includedCollectionIds: string[];
  excludedCollections: Array<{ id: string; title: string }>;
  excludedTitleTerms: string[];
  excludedTitleAttributes: string[];
  excludedProductTags: string[];
  showSalePriceInGoogleFeed: boolean;
  useProductImageAsMainImage: boolean;
  includeShippingWeightInGoogleFeed: boolean;
  excludeOutOfStockItems: boolean;
  ignoreShopifyInventoryInGoogleFeed: boolean;
  inventorySourceMode: "ALL_LOCATIONS" | "SELECTED_LOCATIONS";
  selectedInventoryLocationIds: string[];
  disableUtmParameters: boolean;
  checkoutLinkMode: "DISABLED" | "CART" | "CHECKOUT";
}
export interface MarketConfigurationFeed {
  feedType: string;
  customConfigurationEnabled?: boolean | null;
  customConfiguration?: unknown;
}
export function pickMarketConfiguration(
  primary: unknown,
): Partial<MarketConfiguration> & Record<string, unknown>;
export function validateMarketConfiguration(
  value: unknown,
  options?: { complete?: boolean },
): MarketConfiguration & Record<string, unknown>;
export function resolveEffectiveFeedConfiguration<T extends object>(
  primary: T,
  feed: MarketConfigurationFeed,
): T;
export function primaryChangeAffectsFeed(
  previous: object | null,
  next: object,
  feed: MarketConfigurationFeed,
): boolean;
