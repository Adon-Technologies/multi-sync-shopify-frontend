import {
  DEFAULT_COLOR_OPTIONS,
  DEFAULT_SIZE_OPTIONS,
  normalizeOptionNames,
} from "./configuration-validation.ts";
import {
  inferCatalogAttribute,
  normalizeCatalogText,
  resolveProductExclusions,
} from "@multi-sync/catalog-rules";

export const DIAGNOSTICS_CLASSIFICATION_VERSION =
  "diagnostics-v14-multi-filters";

export type DiagnosticStatus = "submitted" | "warning" | "error";

export interface DiagnosticWarning {
  code: string;
  message: string;
}

export interface RawDiagnosticProduct {
  id: string;
  title: string;
  createdAt: string;
  categoryName: string | null;
  description: string | null;
  price: string | null;
  productType: string | null;
  vendor?: string | null;
  tags: string[];
  imageUrl: string | null;
  imageAlt: string | null;
  collectionIds?: string[];
  options: Array<{
    name: string;
    values: string[];
  }>;
  metafields: Array<{
    attribute?: DiagnosticAttribute;
    namespace: string;
    key: string;
    type: string;
    value: string;
    jsonValue?: unknown;
    referencedValues?: string[];
  }>;
}

export interface DiagnosticExclusionRules {
  colorOptions?: string[];
  excludedCollections: Array<{
    id: string;
    title: string;
  }>;
  excludedTitleTerms: string[];
  sizeOptions?: string[];
}

export interface DiagnosticProduct {
  id: string;
  title: string;
  createdAt: string;
  categoryName: string | null;
  genderValues: string[];
  ageValues: string[];
  colorValues: string[];
  sizeValues: string[];
  vendor: string | null;
  customLabel0Values: string[];
  customLabel1Values: string[];
  customLabel2Values: string[];
  customLabel3Values: string[];
  customLabel4Values: string[];
  productType: string | null;
  tags: string[];
  imageUrl: string | null;
  imageAlt: string | null;
  status: DiagnosticStatus;
  warnings: DiagnosticWarning[];
}

export type DiagnosticAttribute = "gender" | "age" | "size" | "color";

const comparableAttributes: Array<{
  key: DiagnosticAttribute;
  label: string;
}> = [
  { key: "gender", label: "Gender" },
  { key: "age", label: "Age" },
  { key: "size", label: "Size" },
  { key: "color", label: "Color" },
];

function normalizeIdentifier(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function getDiagnosticAttribute(
  value: string,
): DiagnosticAttribute | null {
  return inferCatalogAttribute(value);
}

function splitScalarValue(value: string) {
  return value
    .split(/[,|;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const preferredStructuredKeys = new Set([
  "amount",
  "displayname",
  "label",
  "name",
  "text",
  "value",
  "values",
]);

const ignoredStructuredKeys = new Set([
  "currencycode",
  "handle",
  "id",
  "type",
  "unit",
  "url",
]);

function flattenParsedValue(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(flattenParsedValue);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return splitScalarValue(String(value));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    const preferredEntries = entries.filter(([key]) =>
      preferredStructuredKeys.has(normalizeIdentifier(key)),
    );
    const semanticEntries =
      preferredEntries.length > 0
        ? preferredEntries
        : entries.filter(
            ([key]) => !ignoredStructuredKeys.has(normalizeIdentifier(key)),
          );

    return semanticEntries.flatMap(([, nestedValue]) =>
      flattenParsedValue(nestedValue),
    );
  }

  return [];
}

function parseJsonValue(value: string) {
  try {
    return { parsed: true as const, value: JSON.parse(value) as unknown };
  } catch {
    return { parsed: false as const, value: undefined };
  }
}

function isReferenceType(type: string) {
  return type.toLocaleLowerCase().includes("reference");
}

function parseMetafieldValue(
  metafield: RawDiagnosticProduct["metafields"][number],
) {
  if (isReferenceType(metafield.type)) {
    return flattenParsedValue(metafield.referencedValues ?? []);
  }

  if (metafield.jsonValue !== undefined) {
    return flattenParsedValue(metafield.jsonValue);
  }

  const trimmed = metafield.value.trim();
  if (!trimmed) {
    return [];
  }

  const parsedValue = parseJsonValue(trimmed);
  if (parsedValue.parsed) {
    return flattenParsedValue(parsedValue.value);
  }

  const normalizedType = metafield.type.toLocaleLowerCase();
  if (normalizedType === "json" || normalizedType.startsWith("list.")) {
    return [];
  }

  return flattenParsedValue(trimmed);
}

function collectReferenceIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectReferenceIds);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(collectReferenceIds);
  }

  if (
    typeof value === "string" &&
    /^gid:\/\/shopify\/[A-Za-z0-9_]+\/[^/\s]+$/.test(value.trim())
  ) {
    return [value.trim()];
  }

  return [];
}

export function getMetafieldReferenceIds(
  metafield: RawDiagnosticProduct["metafields"][number],
) {
  if (!isReferenceType(metafield.type)) {
    return [];
  }

  const parsedRawValue = parseJsonValue(metafield.value);
  const parsedValue =
    metafield.jsonValue !== undefined
      ? metafield.jsonValue
      : parsedRawValue.parsed
        ? parsedRawValue.value
        : metafield.value;

  return [...new Set(collectReferenceIds(parsedValue))];
}

function normalizeValueSet(values: string[]) {
  return new Set(
    values
      .map((value) =>
        value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(),
      )
      .filter(Boolean),
  );
}

export function normalizeDiagnosticMatchText(value: string) {
  return normalizeCatalogText(value);
}

export function getDiagnosticExclusionReasons(
  product: RawDiagnosticProduct,
  rules?: DiagnosticExclusionRules,
) {
  if (!rules) {
    return [];
  }

  return resolveProductExclusions(product, rules);
}

function equalSets(left: Set<string>, right: Set<string>) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function hasPositivePrice(value: string | null) {
  const normalizedPrice = value?.trim();

  if (!normalizedPrice) {
    return false;
  }

  const amount = Number(normalizedPrice);

  return Number.isFinite(amount) && amount > 0;
}

function collectAttributeValues(
  product: RawDiagnosticProduct,
  source: "options" | "metafields",
  rules?: DiagnosticExclusionRules,
) {
  const values = new Map<DiagnosticAttribute, string[]>();

  if (source === "options") {
    const colorOptionNames = new Set(
      normalizeOptionNames(rules?.colorOptions ?? DEFAULT_COLOR_OPTIONS).map(
        normalizeDiagnosticMatchText,
      ),
    );
    const sizeOptionNames = new Set(
      normalizeOptionNames(rules?.sizeOptions ?? DEFAULT_SIZE_OPTIONS).map(
        normalizeDiagnosticMatchText,
      ),
    );

    for (const option of product.options) {
      const optionName = normalizeDiagnosticMatchText(option.name);
      const inferredAttribute = getDiagnosticAttribute(option.name);
      const attributes = new Set<DiagnosticAttribute>();

      if (inferredAttribute === "gender" || inferredAttribute === "age") {
        attributes.add(inferredAttribute);
      }
      if (colorOptionNames.has(optionName)) {
        attributes.add("color");
      }
      if (sizeOptionNames.has(optionName)) {
        attributes.add("size");
      }

      for (const attribute of attributes) {
        values.set(attribute, [
          ...(values.get(attribute) ?? []),
          ...option.values,
        ]);
      }
    }

    return values;
  }

  for (const metafield of product.metafields) {
    const attribute =
      metafield.attribute ?? getDiagnosticAttribute(metafield.key);

    if (attribute) {
      values.set(attribute, [
        ...(values.get(attribute) ?? []),
        ...parseMetafieldValue(metafield),
      ]);
    }
  }

  return values;
}

function uniqueFilterValues(values: string[]) {
  const uniqueValues = new Map<string, string>();

  for (const value of values) {
    const trimmed = value.trim();
    const comparable = normalizeDiagnosticMatchText(trimmed);

    if (comparable && !uniqueValues.has(comparable)) {
      uniqueValues.set(comparable, trimmed);
    }
  }

  return [...uniqueValues.values()];
}

/**
 * Product-level validation intentionally has no Shopify dependencies. New GMC
 * warning rules and future exclusion errors can be added here without changing
 * pagination, caching, or the Diagnostics UI. Color and Size variant-option
 * aliases come from the store configuration, while a valid product metafield
 * can independently supply the same standard attribute.
 */
export function validateDiagnosticProduct(
  product: RawDiagnosticProduct,
  exclusionRules?: DiagnosticExclusionRules,
): DiagnosticProduct {
  const metafieldValues = collectAttributeValues(product, "metafields");
  const optionValues = collectAttributeValues(
    product,
    "options",
    exclusionRules,
  );
  const filterMetadata = {
    genderValues: uniqueFilterValues(metafieldValues.get("gender") ?? []),
    ageValues: uniqueFilterValues(metafieldValues.get("age") ?? []),
    colorValues: uniqueFilterValues(optionValues.get("color") ?? []),
    sizeValues: uniqueFilterValues(optionValues.get("size") ?? []),
    vendor: product.vendor?.trim() || null,
    customLabel0Values: [],
    customLabel1Values: [],
    customLabel2Values: [],
    customLabel3Values: [],
    customLabel4Values: [],
    tags: uniqueFilterValues(product.tags),
  };
  const exclusionReasons = getDiagnosticExclusionReasons(
    product,
    exclusionRules,
  );

  if (exclusionReasons.length > 0) {
    return {
      id: product.id,
      title: product.title,
      createdAt: product.createdAt,
      categoryName: product.categoryName,
      ...filterMetadata,
      productType: product.productType,
      imageUrl: product.imageUrl,
      imageAlt: product.imageAlt,
      status: "error",
      warnings: exclusionReasons,
    };
  }

  const warnings: DiagnosticWarning[] = [];
  for (const attribute of comparableAttributes) {
    const optionSet = normalizeValueSet(optionValues.get(attribute.key) ?? []);
    const metafieldSet = normalizeValueSet(
      metafieldValues.get(attribute.key) ?? [],
    );

    if (optionSet.size === 0 && metafieldSet.size === 0) {
      warnings.push({
        code: `missing-${attribute.key}`,
        message: `Missing value: ${attribute.label}.`,
      });
    } else if (
      optionSet.size > 0 &&
      metafieldSet.size > 0 &&
      !equalSets(optionSet, metafieldSet)
    ) {
      warnings.push({
        code: `mismatch-${attribute.key}`,
        message: `Mismatch detected in ${attribute.label}.`,
      });
    }
  }

  if (!product.title.trim()) {
    warnings.push({ code: "missing-title", message: "Missing value: Title." });
  }

  if (!product.description?.trim()) {
    warnings.push({
      code: "missing-description",
      message: "Missing value: Description.",
    });
  }

  if (!hasPositivePrice(product.price)) {
    warnings.push({ code: "missing-price", message: "Missing value: Price." });
  }

  return {
    id: product.id,
    title: product.title,
    createdAt: product.createdAt,
    categoryName: product.categoryName,
    ...filterMetadata,
    productType: product.productType,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    status: warnings.length === 0 ? "submitted" : "warning",
    warnings,
  };
}

export function countDiagnosticProducts(products: DiagnosticProduct[]) {
  let submitted = 0;
  let warnings = 0;
  let excluded = 0;

  for (const product of products) {
    if (product.status === "submitted") {
      submitted += 1;
    } else if (product.status === "warning") {
      warnings += 1;
    } else {
      excluded += 1;
    }
  }

  return {
    allProducts: products.length,
    submitted,
    warnings,
    excluded,
  };
}
