export const DIAGNOSTICS_PAGE_SIZES = [10, 25, 50] as const;

export type DiagnosticsPageSize = (typeof DIAGNOSTICS_PAGE_SIZES)[number];

export const DEFAULT_DIAGNOSTICS_PAGE_SIZE: DiagnosticsPageSize = 25;

export function normalizeDiagnosticsPageSize(
  value: unknown,
): DiagnosticsPageSize {
  const numericValue = typeof value === "number" ? value : Number(value);
  return DIAGNOSTICS_PAGE_SIZES.includes(numericValue as DiagnosticsPageSize)
    ? (numericValue as DiagnosticsPageSize)
    : DEFAULT_DIAGNOSTICS_PAGE_SIZE;
}
