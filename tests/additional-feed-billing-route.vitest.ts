import { beforeEach, expect, it, vi } from "vitest";
import { action, loader } from "../app/routes/app.additional-feed-billing";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), backend: vi.fn() }));
vi.mock("../app/shopify.server", () => ({
  authenticateActiveAdmin: mocks.auth,
}));
vi.mock("../app/services/feed-backend.server", () => ({
  requestFeedBackend: mocks.backend,
  FeedBackendError: class extends Error {},
}));
const session = { shop: "mine.myshopify.com", accessToken: "mock" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ session });
  mocks.backend.mockResolvedValue({ ok: true });
});
const args = (body?: unknown) => ({
  request: new Request(
    "https://app.example/app/additional-feed-billing",
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  ),
  params: {},
  context: {},
  unstable_pattern: "app/additional-feed-billing",
});
it("checks eligibility without a mutation and disables caching", async () => {
  const response = await loader(args());
  expect(mocks.backend).toHaveBeenCalledWith(
    session,
    "GET",
    "/api/subscription/additional-feeds/eligibility",
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("requires explicit consent before forwarding cancellation", async () => {
  for (const confirmed of [undefined, false, "true"])
    expect(
      (await action(args({ confirmed, subscriptionId: "old" }))).status,
    ).toBe(400);
  expect(mocks.backend).not.toHaveBeenCalled();
});
it("uses the authenticated store and strips client supplied cancellation settings", async () => {
  await action(
    args({
      confirmed: true,
      subscriptionId: "old",
      shop: "other",
      prorate: false,
      immediate: false,
    }),
  );
  expect(mocks.backend).toHaveBeenCalledWith(
    session,
    "POST",
    "/api/subscription/additional-feeds/renew",
    { confirmed: true, subscriptionId: "old" },
  );
});
it("rejects unauthenticated requests before contacting the backend", async () => {
  mocks.auth.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  await expect(
    action(args({ confirmed: true, subscriptionId: "old" })),
  ).rejects.toHaveProperty("status", 401);
  expect(mocks.backend).not.toHaveBeenCalled();
});
