export type CatalogAttribute = "gender" | "age" | "size" | "color";

export interface CatalogExclusionProduct {
  title: string;
  collectionIds?: string[];
}

export interface CatalogExclusionRules {
  excludedCollections: Array<{
    id: string;
    title: string;
  }>;
  excludedTitleTerms: string[];
}

export interface CatalogExclusionReason {
  code: string;
  message: string;
}

export function normalizeCatalogText(value: unknown): string;
export function normalizeCatalogIdentifier(value: unknown): string;
export function inferCatalogAttribute(
  value: unknown,
): CatalogAttribute | null;
export function resolveProductExclusions(
  product: CatalogExclusionProduct,
  rules?: CatalogExclusionRules,
): CatalogExclusionReason[];
