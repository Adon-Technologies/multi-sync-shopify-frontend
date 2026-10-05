const attributeAliases = {
  gender: new Set(["gender", "targetgender"]),
  age: new Set(["age", "agegroup", "agerange", "targetage", "targetagegroup"]),
  size: new Set([
    "size",
    "apparelsize",
    "clothingsize",
    "productsize",
    "shoesize",
  ]),
  color: new Set([
    "color",
    "colour",
    "colorpattern",
    "colourpattern",
    "productcolor",
    "productcolour",
  ]),
};

export function normalizeCatalogText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function normalizeCatalogIdentifier(value) {
  return normalizeCatalogText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

export function inferCatalogAttribute(value) {
  const normalized = normalizeCatalogIdentifier(value);

  for (const [attribute, aliases] of Object.entries(attributeAliases)) {
    if (aliases.has(normalized)) {
      return attribute;
    }
  }

  return null;
}

// Preserve tag spelling for display; use the existing catalog normalization for keys.
export function normalizeExcludedProductTags(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .filter((value) => {
      if (typeof value !== "string") return false;
      const key = normalizeCatalogText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((value) => value.trim());
}

export function createProductExclusionResolver(rules) {
  const tags = new Set(
    normalizeExcludedProductTags(rules?.excludedProductTags).map(
      normalizeCatalogText,
    ),
  );
  return (product) => resolveProductExclusions(product, rules, tags);
}

export function resolveProductExclusions(product, rules, excludedTags) {
  if (!rules) {
    return [];
  }

  const productCollectionIds = new Set(product.collectionIds ?? []);
  const reasons = [];

  for (const collection of rules.excludedCollections ?? []) {
    if (productCollectionIds.has(collection.id)) {
      reasons.push({
        code: `excluded-collection-${collection.id.split("/").at(-1)}`,
        message: `Excluded collection: ${collection.title}`,
      });
    }
  }

  const normalizedTitle = normalizeCatalogText(product.title);
  const matchedTerms = new Set();

  for (const term of rules.excludedTitleTerms ?? []) {
    const normalizedTerm = normalizeCatalogText(term);

    if (
      normalizedTerm &&
      normalizedTitle.includes(normalizedTerm) &&
      !matchedTerms.has(normalizedTerm)
    ) {
      matchedTerms.add(normalizedTerm);
      reasons.push({
        code: `excluded-title-${matchedTerms.size}`,
        message: `Excluded by title term: ${term}`,
      });
    }
  }

  const tagKeys =
    excludedTags ??
    new Set(
      normalizeExcludedProductTags(rules.excludedProductTags).map(
        normalizeCatalogText,
      ),
    );
  const matchedTags = new Set();
  for (const tag of product.tags ?? []) {
    const key = normalizeCatalogText(tag);
    if (tagKeys.has(key) && !matchedTags.has(key)) {
      matchedTags.add(key);
      reasons.push({
        code: `excluded-tag-${matchedTags.size}`,
        message: `Excluded by tag: ${tag}`,
      });
    }
  }

  return reasons;
}

/** Shared Configuration and feed identity validation; no separate country list. */
export function normalizeCountryCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

/** Preserve literal merchant text while trimming and deduplicating entries. */
export function normalizeExcludedTitleAttributes(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.filter((value) => typeof value === "string").map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Canonical Google gender values, including legacy Gender Rules labels. */
export function normalizeGenderValue(value) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : "";
  if (normalized === "men" || normalized === "male") return "male";
  if (normalized === "women" || normalized === "female") return "female";
  if (normalized === "unisex") return "unisex";
  return null;
}

/** Existing Google age groups; normalize output without changing Shopify sources. */
export function normalizeAgeGroupValue(value) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase() : "";
  if (normalized === "kid") return "kids";
  return ["adult", "toddler", "infant", "newborn", "kids"].includes(normalized)
    ? normalized : null;
}

/** Compile once per feed. Storage order remains first-match-wins. */
export function createFeedAttributeResolver(kind, configuration) {
  const normalize = kind === "gender" ? normalizeGenderValue : normalizeAgeGroupValue;
  const rules = (configuration?.rules ?? []).map((rule) => ({
    value: normalize(rule.value),
    collections: new Set(rule.collectionIds ?? []),
    tags: new Set(normalizeExcludedProductTags(rule.tags).map(normalizeCatalogText)),
  }));
  const fallback = normalize(configuration?.defaultValue);
  return (product, existingValues) => {
    const collections = product.collectionIds ?? [];
    const tags = (product.tags ?? []).map(normalizeCatalogText);
    for (const rule of rules) {
      if (rule.value && (collections.some((id) => rule.collections.has(id)) ||
        tags.some((tag) => rule.tags.has(tag)))) return rule.value;
    }
    for (const value of Array.isArray(existingValues) ? existingValues : [existingValues]) {
      const existing = normalize(value);
      if (existing) return existing;
    }
    return fallback;
  };
}
