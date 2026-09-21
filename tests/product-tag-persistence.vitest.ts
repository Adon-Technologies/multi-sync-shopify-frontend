import { beforeEach, expect, it, vi } from "vitest";
import {
  getConfigurationPageData,
  getDiagnosticsConfigurationRules,
  saveConfigurationForShop,
} from "../app/services/configuration.server";

const db = vi.hoisted(() => {
  let stored: Record<string, unknown> | null = null;
  return {
    reset: () => {
      stored = null;
    },
    configuration: {
      findUnique: vi.fn(async () => stored),
      upsert: vi.fn(async ({ create, update }) => {
        stored = stored
          ? { ...stored, ...update }
          : {
              id: "config",
              updatedAt: new Date(),
              createdAt: new Date(),
              ageRules: null,
              genderRules: null,
              defaultAgeGroup: null,
              defaultGender: null,
              ageRulesVersion: 0,
              genderRulesVersion: 0,
              ageRulesAppliedVersion: 0,
              genderRulesAppliedVersion: 0,
              ...create,
            };
        return stored;
      }),
      update: vi.fn(async ({ data }) => {
        stored = { ...stored, ...data };
        return stored;
      }),
    },
    store: {
      findUnique: vi.fn(async () => ({ id: "store", configuration: stored })),
    },
    xmlLink: {
      updateMany: vi.fn(async () => ({ count: 2 })),
      count: vi.fn(async () => 2),
    },
    attributeRuleJob: { findMany: vi.fn(async () => []) },
  };
});
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/services/attribute-rule-schema.server", () => ({
  ensureAttributeRuleConfigurationFields: vi.fn(),
}));
vi.mock("../app/services/store.server", () => ({
  upsertInstalledStore: vi.fn(async () => ({ id: "store" })),
}));
vi.mock("../app/services/shopify-locations.server", () => ({
  verifySelectedInventoryLocations: vi.fn(async () => []),
}));
const session = { shop: "test.myshopify.com" };
const admin = { graphql: vi.fn() };
const input = {
  alertsEmail: "owner@example.com",
  countryCode: "US",
  colorOptions: [],
  sizeOptions: [],
  excludedProductTags: [" Clearance ", "CLEARANCE", "google-exclude"],
};
beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
});

it("persists, reloads and clears custom tag exclusions through the real configuration service", async () => {
  const saved = await saveConfigurationForShop(admin, session, input);
  expect(saved.configuration.excludedProductTags).toEqual([
    "Clearance",
    "google-exclude",
  ]);
  expect(db.xmlLink.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { gcsObjectName: { not: null }, storeId: "store" },
      data: { requiresRefresh: true },
    }),
  );
  const loaded = await getConfigurationPageData(admin, session);
  expect(loaded.configuration.excludedProductTags).toEqual(
    saved.configuration.excludedProductTags,
  );
  expect(
    (await getDiagnosticsConfigurationRules(session.shop)).excludedProductTags,
  ).toEqual(saved.configuration.excludedProductTags);
  await saveConfigurationForShop(admin, session, {
    ...input,
    excludedProductTags: [],
  });
  expect(
    (await getConfigurationPageData(admin, session)).configuration
      .excludedProductTags,
  ).toEqual([]);
  expect(admin.graphql).not.toHaveBeenCalled();
});
