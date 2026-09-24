import { expect, it, vi } from "vitest";
import {
  getProductStatistics,
  invalidateDashboardCache,
} from "../app/services/dashboard.server";

it("counts draft products separately from the published feed products", async () => {
  const shop = "dashboard-statistics-test.myshopify.com";
  const graphql = vi.fn(async (_query: string) =>
    new Response(
      JSON.stringify({
        data: {
          totalProducts: { count: 8, precision: "EXACT" },
          publishedProducts: { count: 4, precision: "EXACT" },
          draftProducts: { count: 2, precision: "EXACT" },
          publishedProductPage: {
            nodes: [{ variantsCount: { count: 6, precision: "EXACT" } }],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      }),
      { status: 200 },
    ),
  );

  invalidateDashboardCache(shop);
  const statistics = await getProductStatistics({ graphql }, shop);

  expect(graphql.mock.calls[0][0]).toContain(
    'draftProducts: productsCount(limit: null, query: "status:draft")',
  );
  expect(statistics).toMatchObject({
    totalProducts: 8,
    publishedProducts: 4,
    draftProducts: 2,
    publishedProductVariants: 6,
    unpublishedProducts: 4,
  });
});
