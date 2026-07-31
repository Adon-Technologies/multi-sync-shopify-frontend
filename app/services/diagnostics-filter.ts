export const diagnosticsFilterFields = [
  "merchant-error",
  "gender",
  "age",
  "google-product-category",
  "product-type",
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

export const diagnosticsFilterLabels: Record<
  DiagnosticsFilterField,
  string
> = {
  "merchant-error": "Error from merchant center",
  gender: "Gender",
  age: "Age",
  "google-product-category": "Google product categories",
  "product-type": "Product type",
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
