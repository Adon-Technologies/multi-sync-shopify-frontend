import { expect, it, vi } from "vitest";
import {
  getStoreInformation,
  invalidateDashboardCache,
} from "../app/services/dashboard.server";

it("shows the primary shop locale and primary market name", async () => {
  const shop = "dashboard-language-test.myshopify.com";
  const graphql = vi.fn(async (_query: string) =>
    new Response(
      JSON.stringify({
        data: {
          shop: {
            currencyCode: "EUR",
            myshopifyDomain: shop,
          },
          primaryMarket: { name: "France" },
          shopLocales: [
            { name: "English", primary: false },
            { name: "French", primary: true },
          ],
        },
      }),
      { status: 200 },
    ),
  );

  invalidateDashboardCache(shop);
  const store = await getStoreInformation({ graphql }, shop);

  expect(graphql.mock.calls[0][0]).toContain("shopLocales");
  expect(graphql.mock.calls[0][0]).toContain("primaryMarket");
  expect(store).toEqual({
    currency: "EUR",
    defaultLanguage: "French",
    domain: shop,
    primaryMarket: "France",
  });
});
