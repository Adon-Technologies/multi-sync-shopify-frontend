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

export function resolveProductExclusions(product, rules) {
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

  return reasons;
}
