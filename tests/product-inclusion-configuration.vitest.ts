import { beforeEach, expect, it, vi } from "vitest";
import { getConfigurationPageData, saveConfigurationForShop } from "../app/services/configuration.server";
import { searchShopCollections } from "../app/services/collection-search.server";

const db = vi.hoisted(() => {
  let stored: ({ updatedAt: Date } & Record<string, unknown>) | null = null;
  return {
    reset: () => { stored = null; },
    configuration: {
      findUnique: vi.fn(async () => stored),
      upsert: vi.fn(async ({ create }) => stored ??= { id: "config", createdAt: new Date(), updatedAt: new Date(1), ageRulesVersion: 0, genderRulesVersion: 0, ageRulesAppliedVersion: 0, genderRulesAppliedVersion: 0, ...create }),
      update: vi.fn(async ({ where, data }) => {
        if (where.updatedAt && stored?.updatedAt.getTime() !== where.updatedAt.getTime()) throw Object.assign(new Error("concurrent change"), { code: "P2025" });
        stored = { ...stored, ...data, updatedAt: new Date(stored!.updatedAt.getTime() + 1) };
        return stored;
      }),
    },
    xmlLink: { findMany: vi.fn(async () => [{ id: "primary", feedType: "PRIMARY" }, { id: "additional", feedType: "ADDITIONAL" }]), updateMany: vi.fn(async () => ({ count: 2 })), count: vi.fn(async () => 2) },
    attributeRuleJob: { findMany: vi.fn(async () => []) },
  };
});
vi.mock("../app/db.server", () => ({ default: db }));
vi.mock("../app/services/attribute-rule-schema.server", () => ({ ensureAttributeRuleConfigurationFields: vi.fn() }));
vi.mock("../app/services/store.server", () => ({ upsertInstalledStore: vi.fn(async () => ({ id: "store" })) }));
vi.mock("../app/services/shopify-locations.server", () => ({ verifySelectedInventoryLocations: vi.fn(async () => []) }));
const id = (n: number) => `gid://shopify/Collection/${n}`;
const session = { shop: "test.myshopify.com" };
const base = { alertsEmail: "owner@example.com", countryCode: "US", colorOptions: [], sizeOptions: [], excludedCollections: [] };
let deleted = false;
let title = "Summer";
const admin = { graphql: vi.fn(async (query: string, options: { variables: { ids?: string[]; after?: string | null; first?: number; query?: string | null } }) => Response.json({ data:
  query.includes("ConfigurationCollections(") ? { collections: { nodes: [{ id: id(1), title, productsCount: { count: 124, precision: "EXACT" } }], pageInfo: { hasNextPage: true, endCursor: "next" } } } :
  { nodes: options.variables.ids!.map((id: string) => deleted ? null : { id, title }) },
})) };
beforeEach(() => { db.reset(); vi.clearAllMocks(); deleted = false; title = "Summer"; });

it("saves inclusion IDs, marks all published feeds Refresh required and returns current display names", async () => {
  await saveConfigurationForShop(admin, session, base);
  db.xmlLink.updateMany.mockClear();
  const result = await saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1), id(2)] });
  expect(result.configuration.includedCollectionIds).toEqual([id(1), id(2)]);
  expect(result.configuration.includedCollections?.[0]?.title).toBe("Summer");
  expect(db.xmlLink.updateMany).toHaveBeenCalledWith({ where: { gcsObjectName: { not: null }, storeId: "store", id: { in: ["primary", "additional"] } }, data: { requiresRefresh: true } });
  expect(result.feedRefreshRequired).toBe(true);
  // Only configuration and refresh-state writes exist in this mocked DB. No queue or GCS writes are available.
  expect(admin.graphql.mock.calls.every(([query]) => !query.includes("mutation"))).toBe(true);
});

it("rejects currently excluded collections even when a stale request tries clearing exclusions", async () => {
  await saveConfigurationForShop(admin, session, { ...base, excludedCollections: [{ id: id(1), title }] });
  await expect(saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)] })).rejects.toMatchObject({ fields: { includedCollectionIds: expect.stringContaining("currently excluded") } });
  expect((await db.configuration.findUnique())!.includedCollectionIds).toEqual([]);
});

it("blocks adding an included collection to exclusions until the inclusion is removed", async () => {
  await saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1), id(2)] });
  await expect(saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1), id(2)], excludedCollections: [{ id: id(2), title }] })).rejects.toMatchObject({ fields: { includedCollectionIds: expect.stringContaining("excluded") } });
});

it("deleted collections stay selected on load, have removable missing labels and cannot be saved as valid selections", async () => {
  await saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)] });
  deleted = true;
  const loaded = await getConfigurationPageData(admin, session);
  expect(loaded.configuration.productSubmissionMode).toBe("SELECTED_COLLECTIONS");
  expect(loaded.configuration.includedCollections?.[0]).toMatchObject({ id: id(1), missing: true });
  await expect(saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)] })).rejects.toMatchObject({ fields: { includedCollectionIds: expect.stringContaining("unavailable") } });
});

it("renames update display data while persisted membership IDs stay unchanged", async () => {
  await saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)] });
  title = "Renamed summer";
  const loaded = await getConfigurationPageData(admin, session);
  expect(loaded.configuration.includedCollections?.[0]?.title).toBe(title);
  expect(loaded.configuration.includedCollectionIds).toEqual([id(1)]);
});

it("rejects a stale browser revision without overwriting stored Configuration", async () => {
  const first = await saveConfigurationForShop(admin, session, base);
  await saveConfigurationForShop(admin, session, { ...base, excludedCollections: [{ id: id(2), title }] });
  await expect(saveConfigurationForShop(admin, session, { ...base, expectedUpdatedAt: first.configuration.updatedAt })).rejects.toMatchObject({ fields: { includedCollectionIds: expect.stringContaining("another session") } });
});

it("compare-and-swap rejects a configuration race during Shopify verification", async () => {
  await saveConfigurationForShop(admin, session, base);
  admin.graphql.mockImplementationOnce(async (_query, options) => {
    await db.configuration.update({ where: { id: "config" }, data: { excludedCollections: [{ id: id(1), title }] } });
    return Response.json({ data: { nodes: options.variables.ids!.map((id: string) => ({ id, title })) } });
  });
  await expect(saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)] })).rejects.toMatchObject({ fields: { includedCollectionIds: expect.stringContaining("another session") } });
});

it("collection selector fetches paginated counts with search without fetching collection products", async () => {
  const page = await searchShopCollections(admin, "Summer", "previous");
  expect(page.collections[0]?.productsCount?.count).toBe(124);
  expect(page.pageInfo).toEqual({ hasNextPage: true, endCursor: "next" });
  const [query, options] = admin.graphql.mock.calls[0];
  expect(query).toContain("productsCount { count precision }");
  expect(query).not.toContain("products(");
  expect(options.variables).toEqual({ after: "previous", first: 20, query: "title:Summer*" });
});

it("Primary inclusion changes invalidate Primary and OFF markets while leaving custom markets fresh", async () => {
  await saveConfigurationForShop(admin, session, base);
  db.xmlLink.findMany.mockResolvedValueOnce([
    { id: "primary", feedType: "PRIMARY" }, { id: "additional", feedType: "ADDITIONAL" },
    { id: "custom", feedType: "ADDITIONAL", customConfigurationEnabled: true, customConfiguration: { productSubmissionMode: "ALL_PRODUCTS", includedCollectionIds: [] } },
  ] as never);
  db.xmlLink.updateMany.mockClear();
  await saveConfigurationForShop(admin, session, { ...base, productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: [id(1)] });
  expect(db.xmlLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["primary", "additional"] } }) }));
});

it("Primary Color changes invalidate custom and inherited markets because mappings remain global", async () => {
  await saveConfigurationForShop(admin, session, base);
  db.xmlLink.findMany.mockResolvedValueOnce([
    { id: "primary", feedType: "PRIMARY" }, { id: "additional", feedType: "ADDITIONAL" },
    { id: "custom", feedType: "ADDITIONAL", customConfigurationEnabled: true, customConfiguration: { colorOptions: ["stale-forbidden"] } },
  ] as never);
  db.xmlLink.updateMany.mockClear();
  await saveConfigurationForShop(admin, session, { ...base, colorOptions: ["Colour"] });
  expect(db.xmlLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["primary", "additional", "custom"] } }) }));
});
