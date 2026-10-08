import { beforeEach, expect, it, vi } from "vitest";
import { loadMarketFeedEditor } from "../app/services/market-feed-editor.server";
import { action } from "../app/routes/app.additional-feeds";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  backend: vi.fn(),
  config: vi.fn(),
}));
vi.mock("../app/shopify.server", () => ({
  authenticateSubscribedAdmin: mocks.auth,
}));
vi.mock("../app/services/configuration.server", () => ({
  getConfigurationPageData: mocks.config,
}));
vi.mock("../app/services/feed-backend.server", () => ({
  requestFeedBackend: mocks.backend,
  FeedBackendError: class extends Error {},
}));
vi.mock("../app/services/feed-metadata.server", () => ({
  getStoredAdditionalFeedMetadata: vi.fn(),
}));
const session = { id: "session", shop: "mine.myshopify.com" };
const market = {
  marketId: "gid://shopify/Market/1",
  marketName: "France",
  countryCode: "FR",
  countryName: "France",
  currencyCode: "EUR",
  value: "market|FR",
  availableLanguageCount: 1,
};
const creationPricing = {
  includedAdditionalFeeds: 5,
  currentAdditionalFeeds: 5,
  nextFeedIsBillable: true,
  incrementalPriceCents: 149,
  currency: "USD",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ session, admin: {} });
  mocks.config.mockResolvedValue({ configuration: { countryCode: "GB" } });
  mocks.backend.mockImplementation(async (_session, method, endpoint) =>
    endpoint.endsWith("options")
      ? { ok: true, options: [market] }
      : endpoint.endsWith("languages")
        ? { ok: true, languages: [{ name: "French", locale: "fr" }] }
        : endpoint === "/api/feeds/additional"
          ? { ok: true, usage: { nextFeedPricing: creationPricing } }
          : { ok: true, entry: { feed: { id: "feed" } } },
  );
});
const args = (url: string, params = {}) => ({
  request: new Request(`https://app.example${url}`),
  params,
  context: {},
  unstable_pattern: "app/market-feed/:feedId",
});
it("all setup and edit pages authenticate before loading any configuration", async () => {
  mocks.auth.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  await expect(
    loadMarketFeedEditor(args("/app/market-feed/new")),
  ).rejects.toHaveProperty("status", 401);
  expect(mocks.config).not.toHaveBeenCalled();
  expect(mocks.backend).not.toHaveBeenCalled();
});
it("first setup page obtains existing available combinations without generation or writes", async () => {
  const result = await loadMarketFeedEditor(args("/app/market-feed/new"));
  expect(result.options).toEqual([market]);
  expect(result.selection).toBeNull();
  expect(result.creationPricing).toEqual(creationPricing);
  expect(mocks.backend).toHaveBeenCalledWith(
    session,
    "GET",
    "/api/feeds/additional/options",
  );
  expect(mocks.backend).toHaveBeenCalledWith(session, "GET", "/api/feeds/additional");
  expect(mocks.backend.mock.calls).toHaveLength(2);
  expect(mocks.backend.mock.calls.every((call) => call[1] === "GET")).toBe(true);
});

it("billing data unavailable never silently assumes the next feed is included", async () => {
  mocks.backend.mockImplementation(async (_session, _method, endpoint) =>
    endpoint.endsWith("options") ? { options: [market] } : { ok: true },
  );
  await expect(loadMarketFeedEditor(args("/app/market-feed/new")))
    .rejects.toThrow("Your feed allowance could not be verified");
  expect(mocks.backend.mock.calls.every((call) => call[1] === "GET")).toBe(true);
});
it.each(["L", "FR", "FRA"])("configuration setup loader preserves normalized %s XML code", async (code) => {
  const result = await loadMarketFeedEditor(args(`/app/market-feed/configure?${new URLSearchParams({
    marketId: market.marketId, countryCode: "FR", locale: "fr", idCountryCode: ` ${code.toLowerCase()} `,
  })}`));
  expect(result.selection?.idCountryCode).toBe(code);
  expect(result.selection?.market.countryCode).toBe("FR");
});

it("second setup page revalidates market/language and normalized Country Code without persisting drafts", async () => {
  const result = await loadMarketFeedEditor(
    args(
      `/app/market-feed/configure?${new URLSearchParams({ marketId: market.marketId, countryCode: "FR", locale: "fr", idCountryCode: " lb " })}`,
    ),
  );
  expect(result.selection?.idCountryCode).toBe("LB");
  expect(result.creationPricing).toEqual(creationPricing);
  expect(
    mocks.backend.mock.calls.every(
      (call) => !String(call[2]).includes("generate"),
    ),
  ).toBe(true);
});
it.each([
  {
    marketId: "foreign-market",
    countryCode: "FR",
    locale: "fr",
    idCountryCode: "FR",
  },
  {
    marketId: market.marketId,
    countryCode: "FR",
    locale: "invalid",
    idCountryCode: "FR",
  },
  {
    marketId: market.marketId,
    countryCode: "FR",
    locale: "fr",
    idCountryCode: "invalid",
  },
])(
  "rejects invalid or duplicate/unavailable setup identities %j",
  async (selection) => {
    await expect(
      loadMarketFeedEditor(
        args(`/app/market-feed/configure?${new URLSearchParams(selection)}`),
      ),
    ).rejects.toHaveProperty("status", 400);
    expect(
      mocks.backend.mock.calls.every(
        (call) => !String(call[2]).includes("generate"),
      ),
    ).toBe(true);
  },
);
it("existing editor reads settings only through the authenticated backend scope", async () => {
  await loadMarketFeedEditor(
    args("/app/market-feed/feed?shop=foreign.myshopify.com", {
      feedId: "feed",
    }),
  );
  expect(mocks.backend).toHaveBeenCalledExactlyOnceWith(
    session,
    "GET",
    "/api/feeds/additional/feed/configuration",
  );
});
it("toggle proxy forwards revision and mode without arbitrary market or global identity fields", async () => {
  await action({
    ...args("/app/additional-feeds"),
    request: new Request("https://app.example/app/additional-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "toggle-configuration",
        feedId: "feed",
        customConfigurationEnabled: true,
        expectedRevision: 2,
        shop: "foreign",
        marketId: "foreign",
        genderRules: [],
      }),
    }),
  });
  expect(mocks.backend).toHaveBeenCalledExactlyOnceWith(
    session,
    "POST",
    "/api/feeds/additional/feed/configuration",
    { customConfigurationEnabled: true, expectedRevision: 2 },
  );
});
