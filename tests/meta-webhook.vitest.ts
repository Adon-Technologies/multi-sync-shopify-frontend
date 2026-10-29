import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  webhook: vi.fn(),
  store: vi.fn(),
  backend: vi.fn(),
}));
vi.mock("../app/shopify.server", () => ({
  authenticate: { webhook: mocks.webhook },
}));
vi.mock("../app/db.server", () => ({
  default: { store: { findUnique: mocks.store } },
}));
vi.mock("../app/services/feed-backend.server", () => ({
  requestFeedBackend: mocks.backend,
}));
import { action } from "../app/routes/webhooks.meta.catalog-change";

beforeEach(() => {
  mocks.webhook
    .mockReset()
    .mockResolvedValue({
      shop: "arbitrary.myshopify.com",
      topic: "PRODUCTS_UPDATE",
    });
  mocks.store
    .mockReset()
    .mockResolvedValue({
      accessToken: "private-test-token",
      status: "INSTALLED",
      accessStatus: "ACTIVE",
    });
  mocks.backend.mockReset().mockResolvedValue({ ok: true });
});
const request = () =>
  ({
    request: new Request("https://app.example/webhooks/meta/catalog-change", {
      method: "POST",
    }),
  }) as Parameters<typeof action>[0];
it("requires Shopify authentication and schedules only the verified store without using the event payload as product data", async () => {
  mocks.webhook.mockRejectedValueOnce(new Response(null, { status: 401 }));
  await expect(action(request())).rejects.toBeInstanceOf(Response);
  expect(mocks.backend).not.toHaveBeenCalled();
  expect((await action(request())).status).toBe(204);
  const [session, method, path, body, options] = mocks.backend.mock.calls[0];
  expect(session.shop).toBe("arbitrary.myshopify.com");
  expect(method).toBe("POST");
  expect(path).toBe("/api/integrations/meta");
  expect(body.intent).toBe("sync-change");
  expect(body.actorId).toMatch(/^[a-f0-9]{64}$/);
  expect(body).not.toHaveProperty("products");
  expect(options.readOnlyStore).toBe(true);
});
it.each([
  "PRODUCTS_CREATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
  "INVENTORY_ITEMS_UPDATE",
  "COLLECTIONS_UPDATE",
  "SHOP_UPDATE",
])("%s schedules a catalog update", async (topic) => {
  mocks.webhook.mockResolvedValue({ shop: "other.myshopify.com", topic });
  expect((await action(request())).status).toBe(204);
  expect(mocks.backend.mock.calls[0][0].shop).toBe("other.myshopify.com");
});
it("asks Shopify to retry persistence failures and ignores irrelevant/uninstalled/suspended store events", async () => {
  mocks.backend.mockRejectedValueOnce(new Error("private internal detail"));
  const failure = await action(request());
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain("private");
  mocks.backend.mockClear();
  mocks.webhook.mockResolvedValueOnce({
    shop: "arbitrary.myshopify.com",
    topic: "ORDERS_CREATE",
  });
  expect((await action(request())).status).toBe(204);
  mocks.store.mockResolvedValueOnce(null);
  expect((await action(request())).status).toBe(204);
  mocks.store.mockResolvedValueOnce({
    accessToken: "private",
    status: "UNINSTALLED",
    accessStatus: "ACTIVE",
  });
  expect((await action(request())).status).toBe(204);
  mocks.store.mockResolvedValueOnce({
    accessToken: "private",
    status: "INSTALLED",
    accessStatus: "SUSPENDED",
  });
  expect((await action(request())).status).toBe(204);
  expect(mocks.backend).not.toHaveBeenCalled();
});
