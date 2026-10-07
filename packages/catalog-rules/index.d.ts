export type CatalogAttribute = "gender" | "age" | "size" | "color";

export interface CatalogExclusionProduct {
  title: string;
  collectionIds?: string[];
  tags?: string[];
}

export interface CatalogExclusionRules {
  productSubmissionMode?: "ALL_PRODUCTS" | "SELECTED_COLLECTIONS";
  includedCollectionIds?: string[];
  excludedCollections: Array<{
    id: string;
    title: string;
  }>;
  excludedTitleTerms: string[];
  excludedProductTags?: string[];
}

export interface CatalogExclusionReason {
  code: string;
  message: string;
}

export function normalizeExcludedProductTags(values: unknown): string[];
export function createProductExclusionResolver(
  rules?: CatalogExclusionRules,
): (product: CatalogExclusionProduct) => CatalogExclusionReason[];

export function normalizeCatalogText(value: unknown): string;
export function normalizeCatalogIdentifier(value: unknown): string;
export function inferCatalogAttribute(value: unknown): CatalogAttribute | null;
export function resolveProductExclusions(
  product: CatalogExclusionProduct,
  rules?: CatalogExclusionRules,
): CatalogExclusionReason[];

export function normalizeCountryCode(value: unknown): string | null;

export function normalizeExcludedTitleAttributes(values: unknown): string[];

export function normalizeGenderValue(value: unknown): "male" | "female" | "unisex" | null;

export function normalizeAgeGroupValue(value: unknown): "adult" | "toddler" | "infant" | "newborn" | "kids" | null;
export interface FeedAttributeRuleConfiguration {
  defaultValue: string | null;
  rules: Array<{ value: string; collectionIds: string[]; tags?: string[] }>;
}
export function createFeedAttributeResolver(
  kind: "gender" | "age", configuration?: FeedAttributeRuleConfiguration,
): (product: { collectionIds?: string[]; tags?: string[] }, existingValues: unknown) => string | null;
