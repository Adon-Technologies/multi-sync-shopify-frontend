import { beforeEach, expect, it, vi } from "vitest";
import { action } from "../app/routes/app.feed-preview";
import { FeedBackendError } from "../app/services/feed-backend.server";
const api = vi.hoisted(() => ({ auth: vi.fn(), backend: vi.fn() }));
vi.mock("../app/shopify.server", () => ({ authenticateSubscribedAdmin: api.auth }));
vi.mock("../app/services/feed-backend.server", () => ({ requestFeedBackend: api.backend, FeedBackendError: class extends Error { constructor(message: string, public status = 502) { super(message); } } }));
const session = { shop: "test.myshopify.com", accessToken: "mock" };
beforeEach(() => { vi.clearAllMocks(); api.auth.mockResolvedValue({ session }); api.backend.mockResolvedValue({ ok: true, xml: "<rss/>" }); });
function invoke(body: unknown, method = "POST") { return action({ request: new Request("https://app.example/app/feed-preview", { method, ...(method === "POST" ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) }), params: {}, context: {}, unstable_pattern: "app/feed-preview" }); }
it("requires authenticated billing access before backend work", async () => {
  api.auth.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  await expect(invoke({ productId: "gid://shopify/Product/1" })).rejects.toHaveProperty("status", 401);
  expect(api.backend).not.toHaveBeenCalled();
});
it("uses only the authenticated store and Primary context, suppressing caching and store upsert", async () => {
  const response = await invoke({ productId: "gid://shopify/Product/1", storeId: "foreign", shop: "foreign.myshopify.com", feedType: "ADDITIONAL", marketId: "foreign", locale: "fr" });
  expect(api.backend).toHaveBeenCalledExactlyOnceWith(session, "POST", "/api/feeds/primary/preview", { productId: "gid://shopify/Product/1" }, { readOnlyStore: true, signal: expect.any(AbortSignal) });
  expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(response.status).toBe(200);
});
it.each([null, {}, { productId: "1" }, { productId: "gid://shopify/ProductVariant/1" }, { productId: "gid://shopify/Product/1 OR 2" }])("rejects invalid IDs %s before backend reads", async body => {
  expect((await invoke(body)).status).toBe(400); expect(api.backend).not.toHaveBeenCalled();
});
it("does not accept GET", async () => { expect((await invoke(undefined, "GET")).status).toBe(405); expect(api.backend).not.toHaveBeenCalled(); });
it("preserves safe backend errors and masks unexpected failures", async () => {
  api.backend.mockRejectedValue(new FeedBackendError("This product is no longer available in Shopify.", 404));
  expect((await invoke({ productId: "gid://shopify/Product/1" })).status).toBe(404);
  api.backend.mockRejectedValue(new Error("secret token and stack"));
  const response = await invoke({ productId: "gid://shopify/Product/1" });
  expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret");
});
