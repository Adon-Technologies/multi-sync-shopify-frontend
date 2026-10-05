import {
  normalizeGenderValue,
  normalizeAgeGroupValue,
  normalizeExcludedProductTags,
} from "@multi-sync/catalog-rules";

import {
  normalizeConfigurationText,
  normalizeSelectedCollections,
  type SelectedCollection,
} from "./configuration-validation.ts";

export type AttributeRuleKind = "gender" | "age";
export type GenderRuleValue = "male" | "female" | "unisex";
export type AgeRuleValue = "adult" | "infant" | "kids" | "toddler" | "newborn";

export interface GenderCollectionRule {
  collections: SelectedCollection[];
  tags: string[];
  gender: GenderRuleValue | "";
  id: string;
}

export interface AgeCollectionRule {
  ageGroup: AgeRuleValue | "";
  collections: SelectedCollection[];
  tags: string[];
  id: string;
}

export interface GenderRulesConfiguration {
  defaultGender: GenderRuleValue | null;
  rules: GenderCollectionRule[];
}

export interface AgeRulesConfiguration {
  defaultAgeGroup: AgeRuleValue | null;
  rules: AgeCollectionRule[];
}

export type AttributeRulesConfiguration =
  | GenderRulesConfiguration
  | AgeRulesConfiguration;

export const GENDER_RULE_OPTIONS = [
  { label: "male", value: "male" },
  { label: "female", value: "female" },
  { label: "unisex", value: "unisex" },
] as const;

export const AGE_RULE_OPTIONS = [
  { label: "adult", value: "adult" },
  { label: "infant", value: "infant" },
  { label: "kids", value: "kids" },
  { label: "toddler", value: "toddler" },
  { label: "newborn", value: "newborn" },
] as const;

const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export class AttributeRulesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttributeRulesValidationError";
  }
}

export function hasAttributeRuleProductAccess(scope: string | undefined) {
  const scopes = new Set(
    (scope ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  // These feed transformations require product reads only.
  return scopes.has("read_products") || scopes.has("write_products");
}

function inputRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedRuleId(value: unknown, index: number) {
  const id = typeof value === "string" ? normalizeConfigurationText(value) : "";
  return RULE_ID.test(id) ? id : `rule-${index + 1}`;
}

function normalizedRuleValue(value: unknown, kind: AttributeRuleKind) {
  if (kind === "gender") return normalizeGenderValue(value) ?? "";
  return normalizeAgeGroupValue(value) ?? "";
}

function normalizeRules(
  kind: AttributeRuleKind,
  value: unknown,
): Array<{
  collections: SelectedCollection[];
  tags: string[];
  id: string;
  value: string;
}> {
  const record = inputRecord(value);
  const inputRules = Array.isArray(record.rules) ? record.rules : [];
  const options = kind === "gender" ? GENDER_RULE_OPTIONS : AGE_RULE_OPTIONS;
  const maxRules = options.length;

  if (inputRules.length > maxRules) {
    throw new AttributeRulesValidationError(
      `${kind === "gender" ? "Gender" : "Age"} supports no more than ${maxRules} rules.`,
    );
  }

  const normalized: Array<{
    collections: SelectedCollection[];
    tags: string[];
    id: string;
    value: string;
  }> = [];
  const usedValues = new Set<string>();
  const usedCollections = new Set<string>();

  inputRules.forEach((ruleValue, index) => {
    const rule = inputRecord(ruleValue);
    const selectedValue = normalizedRuleValue(
      kind === "gender" ? rule.gender : rule.ageGroup,
      kind,
    );
    const rawCollections = Array.isArray(rule.collections)
      ? rule.collections
      : [];
    const collections = normalizeSelectedCollections(rawCollections);
    const rawTags = rule.tags ?? [];
    if (
      !Array.isArray(rawTags) ||
      rawTags.some(
        (tag) =>
          typeof tag !== "string" || !tag.trim() || tag.trim().length > 255,
      )
    ) {
      throw new AttributeRulesValidationError(
        `Rule ${index + 1} contains an invalid product tag.`,
      );
    }
    const tags = normalizeExcludedProductTags(rawTags);
    const isCompletelyEmpty =
      !selectedValue && rawCollections.length === 0 && tags.length === 0;

    if (isCompletelyEmpty) return;

    if (!selectedValue || (collections.length === 0 && tags.length === 0)) {
      throw new AttributeRulesValidationError(
        `Rule ${index + 1} must include both a ${kind === "gender" ? "Gender" : "Age Group"} and at least one collection or product tag.`,
      );
    }
    if (collections.length !== rawCollections.length) {
      throw new AttributeRulesValidationError(
        `Rule ${index + 1} contains an invalid collection.`,
      );
    }
    if (usedValues.has(selectedValue)) {
      throw new AttributeRulesValidationError(
        `Each ${kind === "gender" ? "Gender" : "Age Group"} can be used in only one rule.`,
      );
    }

    for (const collection of collections) {
      if (usedCollections.has(collection.id)) {
        throw new AttributeRulesValidationError(
          "A collection can be used in only one rule.",
        );
      }
      usedCollections.add(collection.id);
    }

    usedValues.add(selectedValue);
    normalized.push({
      collections,
      tags,
      id: normalizedRuleId(rule.id, index),
      value: selectedValue,
    });
  });

  return normalized;
}

export function validateGenderRules(value: unknown): GenderRulesConfiguration {
  const record = inputRecord(value);
  const defaultGenderValue = normalizedRuleValue(
    record.defaultGender,
    "gender",
  );
  if (record.defaultGender && !defaultGenderValue) {
    throw new AttributeRulesValidationError("Choose a valid Default Gender.");
  }

  return {
    defaultGender: (defaultGenderValue as GenderRuleValue | "") || null,
    rules: normalizeRules("gender", value).map((rule) => ({
      collections: rule.collections,
      tags: rule.tags,
      gender: rule.value as GenderRuleValue,
      id: rule.id,
    })),
  };
}

export function validateAgeRules(value: unknown): AgeRulesConfiguration {
  const record = inputRecord(value);
  const defaultAgeGroupValue = normalizedRuleValue(
    record.defaultAgeGroup,
    "age",
  );
  if (record.defaultAgeGroup && !defaultAgeGroupValue) {
    throw new AttributeRulesValidationError(
      "Choose a valid Default Age Group.",
    );
  }

  return {
    defaultAgeGroup: (defaultAgeGroupValue as AgeRuleValue | "") || null,
    rules: normalizeRules("age", value).map((rule) => ({
      ageGroup: rule.value as AgeRuleValue,
      collections: rule.collections,
      tags: rule.tags,
      id: rule.id,
    })),
  };
}

export function parseStoredGenderRules(defaultGender: unknown, rules: unknown) {
  try {
    return validateGenderRules({ defaultGender, rules });
  } catch {
    return {
      defaultGender: null,
      rules: [],
    } satisfies GenderRulesConfiguration;
  }
}

export function parseStoredAgeRules(defaultAgeGroup: unknown, rules: unknown) {
  try {
    return validateAgeRules({ defaultAgeGroup, rules });
  } catch {
    return { defaultAgeGroup: null, rules: [] } satisfies AgeRulesConfiguration;
  }
}

export function resolveRuleApplicationValue(
  kind: AttributeRuleKind,
  existingValue: string | null | undefined,
  defaultValue: string | null,
  collectionOverride: string | null,
) {
  if (collectionOverride) {
    return { source: "collection" as const, value: collectionOverride };
  }

  const allowed = new Set<string>(
    (kind === "gender" ? GENDER_RULE_OPTIONS : AGE_RULE_OPTIONS).map(
      ({ value }) => value,
    ),
  );
  const existing = normalizeConfigurationText(
    existingValue ?? "",
  ).toLocaleLowerCase();
  const normalizedExisting =
    kind === "gender"
      ? (normalizeGenderValue(existing) ?? "")
      : kind === "age" && existing === "kid"
        ? "kids"
        : existing;

  if (allowed.has(normalizedExisting)) {
    return { source: "existing" as const, value: normalizedExisting };
  }
  if (defaultValue) {
    return { source: "default" as const, value: defaultValue };
  }
  return { source: "none" as const, value: null };
}
