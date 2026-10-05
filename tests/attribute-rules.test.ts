import assert from "node:assert/strict";
import test from "node:test";

import {
  AttributeRulesValidationError,
  GENDER_RULE_OPTIONS,
  parseStoredGenderRules,
  hasAttributeRuleProductAccess,
  resolveRuleApplicationValue,
  validateAgeRules,
  validateGenderRules,
} from "../app/services/attribute-rules.ts";

const collection = (id: number, title = `Collection ${id}`) => ({
  id: `gid://shopify/Collection/${id}`,
  title,
});

test("write_products satisfies both product read and write rule access", () => {
  assert.equal(hasAttributeRuleProductAccess("write_products"), true);
  assert.equal(
    hasAttributeRuleProductAccess("read_products, write_products"),
    true,
  );
  assert.equal(hasAttributeRuleProductAccess("read_products"), true);
});

test("Gender defaults fill missing or invalid values and preserve valid values", () => {
  assert.deepEqual(
    resolveRuleApplicationValue("gender", null, "unisex", null),
    { source: "default", value: "unisex" },
  );
  assert.deepEqual(resolveRuleApplicationValue("gender", "", "unisex", null), {
    source: "default",
    value: "unisex",
  });
  assert.deepEqual(
    resolveRuleApplicationValue("gender", " female ", "unisex", null),
    { source: "existing", value: "female" },
  );
});

test("Gender collection rules override existing values and defaults", () => {
  assert.deepEqual(
    resolveRuleApplicationValue("gender", "female", "unisex", "male"),
    { source: "collection", value: "male" },
  );
  assert.deepEqual(
    resolveRuleApplicationValue("gender", null, "unisex", "male"),
    { source: "collection", value: "male" },
  );
});

test("Gender rule values and collections are unique", () => {
  assert.throws(
    () =>
      validateGenderRules({
        defaultGender: "unisex",
        rules: [
          {
            collections: [collection(1)],
            gender: "male",
            id: "rule-1",
          },
          {
            collections: [collection(2)],
            gender: "male",
            id: "rule-2",
          },
        ],
      }),
    AttributeRulesValidationError,
  );
  assert.throws(
    () =>
      validateGenderRules({
        defaultGender: null,
        rules: [
          {
            collections: [collection(1)],
            gender: "male",
            id: "rule-1",
          },
          {
            collections: [collection(1)],
            gender: "female",
            id: "rule-2",
          },
        ],
      }),
    /collection can be used in only one rule/i,
  );
});

test("Gender rejects incomplete rules and more than three rules", () => {
  assert.throws(
    () =>
      validateGenderRules({
        defaultGender: null,
        rules: [{ collections: [], gender: "male", id: "rule-1" }],
      }),
    /both a Gender and at least one collection/,
  );
  assert.throws(
    () =>
      validateGenderRules({
        defaultGender: null,
        rules: Array.from({ length: 4 }, (_, index) => ({
          collections: [collection(index + 1)],
          gender: "male",
          id: `rule-${index + 1}`,
        })),
      }),
    /no more than 3/,
  );
});

test("Age defaults and collection rules follow the same precedence", () => {
  assert.deepEqual(resolveRuleApplicationValue("age", null, "adult", null), {
    source: "default",
    value: "adult",
  });
  assert.deepEqual(
    resolveRuleApplicationValue("age", "newborn", "adult", null),
    { source: "existing", value: "newborn" },
  );
  assert.deepEqual(
    resolveRuleApplicationValue("age", "adult", "newborn", "kids"),
    { source: "collection", value: "kids" },
  );
});

test("Age maps Kid to kids and normalizes stored rules", () => {
  assert.deepEqual(
    validateAgeRules({
      defaultAgeGroup: " Kid ",
      rules: [
        {
          ageGroup: "ADULT",
          collections: [collection(4, "  Adults  ")],
          id: "age-1",
        },
      ],
    }),
    {
      defaultAgeGroup: "kids",
      rules: [
        {
          ageGroup: "adult",
          tags: [],
          collections: [collection(4, "Adults")],
          id: "age-1",
        },
      ],
    },
  );
});

test("Age rejects duplicate values, duplicate collections, and more than five rules", () => {
  assert.throws(
    () =>
      validateAgeRules({
        defaultAgeGroup: null,
        rules: [
          {
            ageGroup: "adult",
            collections: [collection(1)],
            id: "age-1",
          },
          {
            ageGroup: "adult",
            collections: [collection(2)],
            id: "age-2",
          },
        ],
      }),
    /can be used in only one rule/,
  );
  assert.throws(
    () =>
      validateAgeRules({
        defaultAgeGroup: null,
        rules: [
          {
            ageGroup: "adult",
            collections: [collection(1)],
            id: "age-1",
          },
          {
            ageGroup: "kids",
            collections: [collection(1)],
            id: "age-2",
          },
        ],
      }),
    /collection can be used in only one rule/i,
  );
  assert.throws(
    () =>
      validateAgeRules({
        defaultAgeGroup: null,
        rules: Array.from({ length: 6 }, (_, index) => ({
          ageGroup: "adult",
          collections: [collection(index + 1)],
          id: `age-${index + 1}`,
        })),
      }),
    /no more than 5/,
  );
});

test("completely empty draft rules are discarded without changing saved rules", () => {
  assert.deepEqual(
    validateGenderRules({
      defaultGender: "female",
      rules: [{ collections: [], gender: "", id: "unsaved-empty" }],
    }),
    {
      defaultGender: "female",
      rules: [],
    },
  );
});

test("Gender choices display the exact canonical XML values", () => {
  assert.deepEqual(GENDER_RULE_OPTIONS, [
    { label: "male", value: "male" },
    { label: "female", value: "female" },
    { label: "unisex", value: "unisex" },
  ]);
});
for (const [legacy, canonical] of [
  ["Men", "male"],
  ["Women", "female"],
  ["Unisex", "unisex"],
]) {
  test(`saved ${legacy} rules survive read and save without recreation`, () => {
    const original = {
      defaultGender: legacy,
      rules: [
        {
          id: "saved-rule",
          gender: legacy,
          collections: [collection(2), collection(1)],
        },
      ],
    };
    const expected = {
      defaultGender: canonical,
      rules: [{ ...original.rules[0], gender: canonical, tags: [] }],
    };
    assert.deepEqual(
      parseStoredGenderRules(original.defaultGender, original.rules),
      expected,
    );
    assert.deepEqual(validateGenderRules(original), expected);
    assert.deepEqual(validateGenderRules(expected), expected);
    assert.deepEqual(
      resolveRuleApplicationValue("gender", legacy, "unisex", null),
      { source: "existing", value: canonical },
    );
  });
}
test("legacy and canonical aliases still cannot create duplicate gender rules", () => {
  assert.throws(
    () =>
      validateGenderRules({
        rules: [
          { id: "a", gender: "Men", collections: [collection(1)] },
          { id: "b", gender: "male", collections: [collection(2)] },
        ],
      }),
    /only one rule/,
  );
});

for (const kind of ["gender", "age"] as const) {
  const validate = kind === "gender" ? validateGenderRules : validateAgeRules;
  const value = kind === "gender" ? { gender: "male" } : { ageGroup: "adult" };
  test(`${kind} saves tag-only and mixed rules, preserving legacy rules`, () => {
    const parsed = validate({
      rules: [{ ...value, id: "tags", tags: [" mens ", "MENS", "adult"] }],
    });
    assert.deepEqual(parsed.rules[0]!.tags, ["mens", "adult"]);
    assert.deepEqual(parsed.rules[0]!.collections, []);
    assert.deepEqual(
      validate({ rules: [{ ...value, collections: [collection(1)] }] })
        .rules[0]!.tags,
      [],
    );
    assert.deepEqual(
      validate({
        rules: [{ ...value, collections: [collection(1)], tags: ["mens"] }],
      }).rules[0]!.tags,
      ["mens"],
    );
  });
  test(`${kind} rejects invalid tag input`, () => {
    for (const tags of ["mens", [123], [" "], ["x".repeat(256)]]) {
      assert.throws(
        () => validate({ rules: [{ ...value, tags }] }),
        /invalid product tag/,
      );
    }
    assert.throws(
      () => validate({ rules: [{ tags: ["mens"] }] }),
      /must include/,
    );
  });
}
