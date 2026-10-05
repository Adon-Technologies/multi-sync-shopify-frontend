import { beforeEach, expect, it, vi } from "vitest";
import { requestFeedBackend } from "../app/services/feed-backend.server";
const api = vi.hoisted(() => ({ read: vi.fn(), upsert: vi.fn() }));
vi.mock("../app/db.server", () => ({ default: { store: { findUnique: api.read } } }));
vi.mock("../app/services/store.server", () => ({ upsertInstalledStore: api.upsert }));
const session = { shop: "test.myshopify.com", accessToken: "session-token" };
beforeEach(() => { vi.clearAllMocks(); api.read.mockResolvedValue({ shopDomain: session.shop, accessToken: "store-token" }); api.upsert.mockResolvedValue({ shopDomain: session.shop, accessToken: "store-token" }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true }))); });
it("preview signs authenticated read-only store access without upserting a store", async () => {
  const signal = new AbortController().signal;
  await requestFeedBackend(session, "POST", "/api/feeds/primary/preview", { productId: "gid://shopify/Product/1" }, { readOnlyStore: true, signal });
  expect(api.read).toHaveBeenCalledExactlyOnceWith({ where: { shopDomain: session.shop }, select: { shopDomain: true, accessToken: true } });
  expect(api.upsert).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/feeds/primary/preview"), expect.objectContaining({ signal, headers: expect.objectContaining({ "x-multi-sync-shop": session.shop, "x-multi-sync-signature": expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
});
it("ordinary feed requests retain their existing store update path", async () => {
  await requestFeedBackend(session, "GET", "/api/feeds/primary"); expect(api.upsert).toHaveBeenCalledExactlyOnceWith(session); expect(api.read).not.toHaveBeenCalled();
});
it("missing stores cannot generate preview requests", async () => {
  api.read.mockResolvedValue(null);
  await expect(requestFeedBackend(session, "POST", "/api/feeds/primary/preview", {}, { readOnlyStore: true })).rejects.toHaveProperty("status", 401);
  expect(fetch).not.toHaveBeenCalled(); expect(api.upsert).not.toHaveBeenCalled();
});
