import { beforeEach, expect, it, vi } from "vitest";
import { action } from "../app/routes/app.additional-feeds";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), backend: vi.fn() }));
vi.mock("../app/shopify.server", () => ({
  authenticateSubscribedAdmin: mocks.auth,
}));
vi.mock("../app/services/feed-metadata.server", () => ({
  getStoredAdditionalFeedMetadata: vi.fn(),
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
function invoke(body: unknown) {
  return action({
    request: new Request("https://app.example/app/additional-feeds", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    params: {},
    context: {},
    unstable_pattern: "app/additional-feeds",
  });
}

it("requires authentication before accepting a feed edit", async () => {
  mocks.auth.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  await expect(
    invoke({ intent: "edit", feedId: "feed", idCountryCode: "LB" }),
  ).rejects.toHaveProperty("status", 401);
  expect(mocks.backend).not.toHaveBeenCalled();
});

it("forwards only normalized Country Code and the authenticated shop session", async () => {
  await invoke({
    intent: "edit",
    feedId: "feed",
    idCountryCode: " lb ",
    marketId: "foreign",
    locale: "fr",
    shop: "foreign.myshopify.com",
  });
  expect(mocks.backend).toHaveBeenCalledExactlyOnceWith(
    session,
    "POST",
    "/api/feeds/additional/feed/country-code",
    { idCountryCode: "LB" },
  );
});

it.each([undefined, null, "", "   ", "LBN", "12"])(
  "rejects invalid or missing code %s for both create and edit",
  async (idCountryCode) => {
    for (const intent of ["generate", "edit"]) {
      const response = await invoke({
        intent,
        feedId: "feed",
        idCountryCode,
        marketId: "market",
        countryCode: "DE",
        locale: "de",
      });
      expect(response.status).toBe(400);
    }
    expect(mocks.backend).not.toHaveBeenCalled();
  },
);

it("keeps market country and XML Country Code separate in Generate feed URL", async () => {
  await invoke({
    intent: "generate",
    countryCode: "DE",
    idCountryCode: "lb",
    marketId: "market",
    locale: "de",
  });
  expect(mocks.backend).toHaveBeenCalledExactlyOnceWith(
    session,
    "POST",
    "/api/feeds/additional/generate",
    {
      paidFeedConfirmed: false,
      countryCode: "DE",
      idCountryCode: "LB",
      marketId: "market",
      locale: "de",
    },
  );
});

it("forwards only explicit consent and feed inputs, discarding client billing numbers", async () => {
  await invoke({
    intent: "generate",
    countryCode: "DE",
    idCountryCode: "GB",
    marketId: "market",
    locale: "de",
    paidFeedConfirmed: true,
    delta: -999,
    price: 0,
    reportedUsage: 999,
    additionalFeedCount: 0,
    subscriptionId: "foreign",
  });
  expect(mocks.backend).toHaveBeenCalledExactlyOnceWith(
    session,
    "POST",
    "/api/feeds/additional/generate",
    {
      paidFeedConfirmed: true,
      countryCode: "DE",
      idCountryCode: "GB",
      marketId: "market",
      locale: "de",
    },
  );
});
