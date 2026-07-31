export const diagnosticsSortValues = [
  "created-desc",
  "created-asc",
  "title-asc",
  "title-desc",
  "product-type-asc",
  "product-type-desc",
] as const;

export type DiagnosticsSort = (typeof diagnosticsSortValues)[number];

export const DEFAULT_DIAGNOSTICS_SORT: DiagnosticsSort = "created-desc";

const diagnosticsSortSet = new Set<string>(diagnosticsSortValues);

export function normalizeDiagnosticsSort(
  value?: string | null,
): DiagnosticsSort {
  return value && diagnosticsSortSet.has(value)
    ? (value as DiagnosticsSort)
    : DEFAULT_DIAGNOSTICS_SORT;
}
