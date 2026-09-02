import {
  normalizeConfigurationText,
  normalizeProductTypes,
} from "./configuration-validation.ts";

export function mergeProductTypeSuggestions(
  ...sources: ReadonlyArray<unknown>
) {
  return normalizeProductTypes(
    sources.flatMap((source) => (Array.isArray(source) ? source : [])),
  ).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function filterProductTypeSuggestions(
  productTypes: readonly string[],
  search: string,
) {
  const normalizedSearch =
    normalizeConfigurationText(search).toLocaleLowerCase();
  if (!normalizedSearch) {
    return [...productTypes];
  }

  return productTypes.filter((productType) =>
    productType.toLocaleLowerCase().includes(normalizedSearch),
  );
}
