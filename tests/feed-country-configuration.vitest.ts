import type { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
import {
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
      updateMany: vi.fn<(args: Prisma.XmlLinkUpdateManyArgs) => Promise<{ count: number }>>(async () => ({
        count: 2,
      })),
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

it("Configuration GB to US freezes only unset legacy codes and preserves explicit choices", async () => {
  await saveConfigurationForShop(admin, session, {
    ...input,
    countryCode: "GB",
  });
  const rows = [
    { feedType: "ADDITIONAL", idCountryCode: null },
    { feedType: "ADDITIONAL", idCountryCode: undefined },
    { feedType: "ADDITIONAL", idCountryCode: "LB" },
    { feedType: "PRIMARY", idCountryCode: null },
  ];
  db.xmlLink.updateMany.mockClear();
  db.xmlLink.updateMany.mockImplementation(async ({ where, data }) => {
    if ("idCountryCode" in data) {
      expect(where?.storeId).toBe("store");
      expect(where?.feedType).toBe("ADDITIONAL");
      expect(where?.OR).toEqual([
        { idCountryCode: null },
        { idCountryCode: { isSet: false } },
        { idCountryCode: "" },
      ]);
      expect((await db.configuration.findUnique())?.countryCode).toBe("GB");
      for (const row of rows)
        if (row.feedType === "ADDITIONAL" && !row.idCountryCode)
          row.idCountryCode = data.idCountryCode as string;
    }
    return { count: 2 };
  });
  const result = await saveConfigurationForShop(admin, session, {
    ...input,
    countryCode: "US",
  });
  expect(result.configuration.countryCode).toBe("US");
  expect(rows.map((row) => row.idCountryCode)).toEqual([
    "GB",
    "GB",
    "LB",
    null,
  ]);
  expect(db.xmlLink.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { idCountryCode: "GB" } }),
  );
});
