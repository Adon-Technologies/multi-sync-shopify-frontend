import { beforeEach, expect, it, vi } from "vitest";
import { action } from "../app/routes/app.feed-data";
const api = vi.hoisted(() => ({ auth: vi.fn(), backend: vi.fn() }));
vi.mock("../app/shopify.server", () => ({ authenticateSubscribedAdmin: api.auth }));
vi.mock("../app/services/feed-metadata.server", () => ({ getStoredPrimaryFeedMetadata: vi.fn() }));
vi.mock("../app/services/feed-backend.server", () => ({
  requestFeedBackend: api.backend, requestPrimaryFeedInstallBootstrap: vi.fn(),
  FeedBackendError: class extends Error { constructor(message: string, public status = 502) { super(message); } },
}));
const session = { shop: "test.myshopify.com", accessToken: "mock" };
beforeEach(() => { vi.clearAllMocks(); api.auth.mockResolvedValue({ session }); api.backend.mockResolvedValue({ ok: true }); });
function invoke(body?: unknown) {
  return action({ request: new Request("https://app.example/app/feed-data", { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) }), params: {}, context: {}, unstable_pattern: "app/feed-data" });
}

it("keeps old bodyless refresh requests compatible", async () => {
  expect((await invoke()).status).toBe(202);
  expect(api.backend).toHaveBeenCalledExactlyOnceWith(session, "POST", "/api/feeds/primary/generate");
});
it("forwards only confirmation, never client-supplied store or target market data", async () => {
  await invoke({ confirmationToken: "reviewed", shop: "foreign.myshopify.com", marketId: "foreign", countryCode: "FR", locale: "fr" });
  expect(api.backend).toHaveBeenCalledExactlyOnceWith(session, "POST", "/api/feeds/primary/generate", { confirmationToken: "reviewed" });
});
it("returns a review response without claiming generation was accepted", async () => {
  api.backend.mockResolvedValue({ ok: true, marketChange: { confirmationToken: "new-preview" } });
  expect((await invoke()).status).toBe(200);
});
it("requires authenticated subscription access before any backend operation", async () => {
  api.auth.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  await expect(invoke()).rejects.toHaveProperty("status", 401);
  expect(api.backend).not.toHaveBeenCalled();
});
