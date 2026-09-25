import assert from "node:assert/strict";
import test from "node:test";
import { validateConfigurationInput, configurationRequiresFeedRefresh } from "../app/services/configuration-validation.ts";
const base = { alertsEmail: "a@example.com", countryCode: "US", colorOptions: [], sizeOptions: [] };
test("title attributes normalize, reject invalid input and require refresh on add/remove", () => {
  const empty = validateConfigurationInput(base);
  assert.deepEqual(empty.excludedTitleAttributes, []);
  const saved = validateConfigurationInput({ ...base, excludedTitleAttributes: [" Blue ", "blue", "BLUE", "", "  ", "Kids (2-Pack)"] });
  assert.deepEqual(saved.excludedTitleAttributes, ["Blue", "Kids (2-Pack)"]);
  for (const value of ["Blue", [12], ["x".repeat(256)], Array(101).fill("x")]) {
    assert.throws(() => validateConfigurationInput({ ...base, excludedTitleAttributes: value }));
  }
  assert.ok(configurationRequiresFeedRefresh(empty, saved));
  assert.ok(configurationRequiresFeedRefresh(saved, empty));
});
