export const diagnosticsFilterFields = [
  "merchant-error",
  "gender",
  "age",
  "color",
  "size",
  "vendor",
  "custom-label-0",
  "custom-label-1",
  "custom-label-2",
  "custom-label-3",
  "custom-label-4",
  "google-product-category",
  "product-type",
  "collection",
  "tag",
] as const;

export type DiagnosticsFilterField = (typeof diagnosticsFilterFields)[number];

export interface DiagnosticsFilter {
  field: DiagnosticsFilterField;
  value: string;
}

export interface DiagnosticsFilterOption {
  label: string;
  value: string;
}

export const diagnosticsFilterLabels: Record<DiagnosticsFilterField, string> = {
  "merchant-error": "Error from merchant center",
  gender: "Gender",
  age: "Age Group",
  color: "Color",
  size: "Size",
  vendor: "Vendor",
  "custom-label-0": "custom_label_0",
  "custom-label-1": "custom_label_1",
  "custom-label-2": "custom_label_2",
  "custom-label-3": "custom_label_3",
  "custom-label-4": "custom_label_4",
  "google-product-category": "Google product categories",
  "product-type": "Product type",
  collection: "Collection",
  tag: "Tag",
};

const diagnosticsFilterFieldSet = new Set<string>(diagnosticsFilterFields);

export function normalizeDiagnosticsFilterField(
  value?: string | null,
): DiagnosticsFilterField | null {
  return value && diagnosticsFilterFieldSet.has(value)
    ? (value as DiagnosticsFilterField)
    : null;
}

export function normalizeDiagnosticsFilter(
  field?: string | null,
  value?: string | null,
): DiagnosticsFilter | null {
  const normalizedField = normalizeDiagnosticsFilterField(field);
  const normalizedValue = value?.trim();

  return normalizedField && normalizedValue
    ? { field: normalizedField, value: normalizedValue }
    : null;
}

const diagnosticsFilterOrder = new Map(
  diagnosticsFilterFields.map((field, index) => [field, index]),
);

/**
 * Diagnostics currently permits one row per filter type. Keeping this
 * normalization at the transport boundary makes equivalent UI orderings share
 * a TanStack/server cache entry and prevents repeated conditions.
 */
export function normalizeDiagnosticsFilters(
  filters?: ReadonlyArray<DiagnosticsFilter | null | undefined> | null,
): DiagnosticsFilter[] {
  const byField = new Map<DiagnosticsFilterField, DiagnosticsFilter>();

  for (const candidate of filters ?? []) {
    const filter = normalizeDiagnosticsFilter(
      candidate?.field,
      candidate?.value,
    );
    if (filter) byField.set(filter.field, filter);
  }

  return [...byField.values()].sort(
    (left, right) =>
      (diagnosticsFilterOrder.get(left.field) ?? Number.MAX_SAFE_INTEGER) -
      (diagnosticsFilterOrder.get(right.field) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function serializeDiagnosticsFilters(
  filters?: ReadonlyArray<DiagnosticsFilter | null | undefined> | null,
) {
  return JSON.stringify(normalizeDiagnosticsFilters(filters));
}

export function diagnosticsFiltersQueryKey(
  filters?: ReadonlyArray<DiagnosticsFilter | null | undefined> | null,
) {
  return normalizeDiagnosticsFilters(filters).map(
    ({ field, value }) => [field, value] as const,
  );
}

export function parseDiagnosticsFilters(
  value?: string | null,
  legacyField?: string | null,
  legacyValue?: string | null,
) {
  if (value) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeDiagnosticsFilters(
          parsed.map((candidate) => {
            if (!candidate || typeof candidate !== "object") return null;
            const record = candidate as Record<string, unknown>;
            return {
              field: String(record.field ?? "") as DiagnosticsFilterField,
              value: String(record.value ?? ""),
            };
          }),
        );
      }
    } catch {
      // Fall through to the legacy single-filter parameters.
    }
  }

  const legacyFilter = normalizeDiagnosticsFilter(legacyField, legacyValue);
  return legacyFilter ? [legacyFilter] : [];
}

export function normalizeDiagnosticsFilterMatchValue(
  field: DiagnosticsFilterField,
  value: string,
) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

  if (field === "gender") {
    if (["man", "men", "male"].includes(normalized)) return "male";
    if (["woman", "women", "female"].includes(normalized)) return "female";
  }
  if (field === "age" && ["kid", "child", "children"].includes(normalized)) {
    return "kids";
  }

  return normalized;
}

export const diagnosticsFreeTextFilterFields = new Set<DiagnosticsFilterField>([
  "color",
  "size",
  "vendor",
  "custom-label-0",
  "custom-label-1",
  "custom-label-2",
  "custom-label-3",
  "custom-label-4",
]);

export const diagnosticsStaticFilterOptions: Partial<
  Record<DiagnosticsFilterField, readonly DiagnosticsFilterOption[]>
> = {
  gender: [
    { label: "Men", value: "male" },
    { label: "Women", value: "female" },
    { label: "Unisex", value: "unisex" },
  ],
  age: [
    { label: "Newborn", value: "newborn" },
    { label: "Infant", value: "infant" },
    { label: "Toddler", value: "toddler" },
    { label: "Kids", value: "kids" },
    { label: "Adult", value: "adult" },
  ],
};
