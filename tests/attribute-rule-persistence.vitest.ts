import { beforeEach, expect, it, vi } from "vitest";
import { saveAttributeRulesForShop } from "../app/services/configuration.server";

const db = vi.hoisted(() => {
  let stored: Record<string, unknown>;
  const jobs = new Map<string, Record<string, unknown>>();
  const database = {
    reset() {
      stored = {
        updatedAt: new Date(),
        id: "config",
        storeId: "store",
        genderRulesVersion: 0,
        ageRulesVersion: 0,
        genderRulesAppliedVersion: 0,
        ageRulesAppliedVersion: 0,
        genderRules: [],
        ageRules: [],
        defaultGender: null,
        defaultAgeGroup: null,
        excludedTitleTerms: [],
        colorOptions: [],
        sizeOptions: [],
      };
      jobs.clear();
    },
    configuration: {
      update: vi.fn(async ({ data }) => {
        for (const [key, value] of Object.entries(data))
          stored[key] =
            typeof value === "object" && value && "increment" in value
              ? Number(stored[key] ?? 0) + Number(value.increment)
              : value;
        return { ...stored };
      }),
    },
    attributeRuleJob: {
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = where.storeId_kind.kind;
        const job = {
          processedProducts: 0,
          totalProducts: null,
          generationStartedAt: null,
          lastError: null,
          ...(jobs.has(key) ? { ...jobs.get(key), ...update } : create),
        };
        jobs.set(key, job);
        return job;
      }),
      findMany: vi.fn(async () => [...jobs.values()]),
    },
    xmlLink: { updateMany: vi.fn(async () => ({ count: 2 })) },
    $transaction: vi.fn(
      async (callback: (transaction: object) => Promise<unknown>) =>
        callback(database),
    ),
  };
  return database;
});
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/services/attribute-rule-schema.server", () => ({
  ensureAttributeRuleConfigurationFields: vi.fn(),
}));
vi.mock("../app/services/store.server", () => ({
  upsertInstalledStore: vi.fn(async () => ({ id: "store" })),
}));
const collection = { id: "gid://shopify/Collection/1", title: "Men" };
const admin = {
  graphql: vi.fn(async (query: string) => {
    expect(query).not.toMatch(
      /\bmutation\b|metafieldsSet|productUpdate|metafieldDefinitionCreate|metafieldDefinitionPin/,
    );
    return new Response(JSON.stringify({ data: { nodes: [collection] } }));
  }),
};
beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
});
for (const kind of ["gender", "age"] as const) {
  for (const match of ["default", "collection", "tag", "mixed"] as const) {
    it(`saving ${kind} ${match} configuration makes no Shopify mutations or writeback jobs`, async () => {
      const value = kind === "gender" ? "male" : "adult";
      const input = {
        [kind === "gender" ? "defaultGender" : "defaultAgeGroup"]: value,
        rules:
          match === "default"
            ? []
            : [
                {
                  id: "rule-1",
                  [kind === "gender" ? "gender" : "ageGroup"]: value,
                  collections:
                    match === "collection" || match === "mixed"
                      ? [collection]
                      : [],
                  tags:
                    match === "tag" || match === "mixed"
                      ? [" mens ", "MENS"]
                      : [],
                },
              ],
      };
      const result = await saveAttributeRulesForShop(
        admin,
        { shop: "test.myshopify.com", scope: "read_products" },
        kind,
        input,
      );
      expect(
        result.configuration[
          kind === "gender" ? "defaultGender" : "defaultAgeGroup"
        ],
      ).toBe(value);
      expect(result.job.status).toBe("COMPLETED");
      expect(result.feedRefreshRequired).toBe(true);
      const rules =
        result.configuration[kind === "gender" ? "genderRules" : "ageRules"];
      if (match !== "default")
        expect(rules[0]!.tags).toEqual(match === "collection" ? [] : ["mens"]);
      expect(admin.graphql).toHaveBeenCalledTimes(
        match === "collection" || match === "mixed" ? 1 : 0,
      );
      expect(db.xmlLink.updateMany).toHaveBeenCalledWith({
        where: { gcsObjectName: { not: null }, storeId: "store" },
        data: { requiresRefresh: true },
      });
      expect(db.attributeRuleJob.upsert.mock.calls[0]![0].create.status).toBe(
        "COMPLETED",
      );
      // A second save also never requeues a historical worker job.
      await saveAttributeRulesForShop(
        admin,
        { shop: "test.myshopify.com", scope: "read_products" },
        kind,
        input,
      );
      expect(db.attributeRuleJob.upsert.mock.calls[1]![0].update.status).toBe(
        "COMPLETED",
      );
      expect(
        result.configuration[
          kind === "gender" ? "genderRulesVersion" : "ageRulesVersion"
        ],
      ).toBe(1);
    });
  }
}
