export type CatalogAttribute = "gender" | "age" | "size" | "color";

export interface CatalogExclusionProduct {
  title: string;
  collectionIds?: string[];
  tags?: string[];
}

export interface CatalogExclusionRules {
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
