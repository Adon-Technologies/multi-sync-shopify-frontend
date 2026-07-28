import { createHash } from "node:crypto";

import {
  DEFAULT_COLOR_OPTIONS,
  DEFAULT_SIZE_OPTIONS,
  normalizeConfigurationText,
  normalizeExcludedTitleTerms,
  normalizeOptionNames,
  normalizeSelectedCollections,
  type SelectedCollection,
} from "./configuration-validation.ts";

export interface DiagnosticsRevisionInput {
  ageRulesAppliedVersion?: number | unknown;
  colorOptions?: string[] | unknown;
  excludedCollections?: SelectedCollection[] | unknown;
  excludedTitleTerms?: string[] | unknown;
  genderRulesAppliedVersion?: number | unknown;
  sizeOptions?: string[] | unknown;
}

function normalizeOptions(values: unknown, defaults: readonly string[]) {
  const normalized = normalizeOptionNames(
    Array.isArray(values) ? values : defaults,
  );

  return normalized
    .map((value) => normalizeConfigurationText(value).toLocaleLowerCase())
    .sort();
}

export function createDiagnosticsConfigurationRevision(
  input: DiagnosticsRevisionInput,
) {
  const collectionIds = normalizeSelectedCollections(input.excludedCollections)
    .map(({ id }) => id)
    .sort();
  const titleTerms = normalizeExcludedTitleTerms(input.excludedTitleTerms)
    .map((term) => term.toLocaleLowerCase())
    .sort();
  const normalizedInput = {
    ageRulesAppliedVersion:
      typeof input.ageRulesAppliedVersion === "number" &&
      Number.isSafeInteger(input.ageRulesAppliedVersion)
        ? input.ageRulesAppliedVersion
        : 0,
    colorOptions: normalizeOptions(input.colorOptions, DEFAULT_COLOR_OPTIONS),
    sizeOptions: normalizeOptions(input.sizeOptions, DEFAULT_SIZE_OPTIONS),
    excludedCollectionIds: collectionIds,
    excludedTitleTerms: titleTerms,
    genderRulesAppliedVersion:
      typeof input.genderRulesAppliedVersion === "number" &&
      Number.isSafeInteger(input.genderRulesAppliedVersion)
        ? input.genderRulesAppliedVersion
        : 0,
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedInput))
    .digest("hex");
}

export const EMPTY_DIAGNOSTICS_CONFIGURATION_REVISION =
  createDiagnosticsConfigurationRevision({});
