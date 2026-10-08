import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MarketFeedEditor } from "../app/components/MarketFeedEditor";
import { ConfigurationsPanel } from "../app/components/ConfigurationsPanel";
import { pickMarketConfiguration } from "@multi-sync/catalog-rules/market-configuration";

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  navigate: vi.fn(),
  toast: { show: vi.fn() },
}));
vi.mock("react-router", () => ({
  useLoaderData: () => mocks.data,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: "/app/market-feed/test", search: "" }),
}));
vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({ toast: mocks.toast }),
  SaveBar: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="region" aria-label="Unsaved changes">{children}</div> : null,
}));
const scope = {
  shop: "test.myshopify.com",
  sessionId: "session",
  locale: null,
};
const primary = {
  alertsEmail: "merchant@example.com",
  countryCode: "GB",
  colorOptions: ["Colour"],
  sizeOptions: ["Size"],
  productSubmissionMode: "ALL_PRODUCTS",
  includedCollectionIds: [],
  excludedCollections: [
    { id: "gid://shopify/Collection/1", title: "Primary exclusion" },
  ],
  excludedTitleTerms: ["hidden"],
  excludedTitleAttributes: ["Blue"],
  excludedProductTags: ["sale"],
  productTypes: [],
  showSalePriceInGoogleFeed: true,
  useProductImageAsMainImage: false,
  includeShippingWeightInGoogleFeed: true,
  excludeOutOfStockItems: true,
  ignoreShopifyInventoryInGoogleFeed: false,
  inventorySourceMode: "ALL_LOCATIONS",
  selectedInventoryLocationIds: [],
  disableUtmParameters: false,
  disablePrimaryCurrencyParameter: false,
  checkoutLinkMode: "DISABLED",
  includedCollections: [],
  updatedAt: "2026-10-01",
};
const market = {
  marketId: "gid://shopify/Market/1",
  marketName: "France",
  countryCode: "FR",
  countryName: "France",
  currencyCode: "EUR",
  value: "market|FR",
};
const language = { locale: "fr", name: "French" };
const feed = {
  id: "feed",
  feedType: "ADDITIONAL",
  customConfigurationEnabled: false,
  marketConfigurationRevision: 0,
  idCountryCode: "FR",
  status: "QUEUED",
  requiresRefresh: false,
  totalProducts: 10,
  processedProducts: 0,
};
const entry = {
  feed,
  market: {
    id: market.marketId,
    name: "France",
    countryCode: "FR",
    countryName: "France",
    languageName: "French",
    locale: "fr",
    currencyCode: "EUR",
  },
};
let currentPrimary = structuredClone(primary);
let client: QueryClient;
let generationStatus: string;
let paid: boolean;
let renewal: boolean;
let failSave: boolean;
const writes: Record<string, unknown>[] = [];
const includedPricing = {
  includedAdditionalFeeds: 5,
  currentAdditionalFeeds: 0,
  nextFeedIsBillable: false,
  incrementalPriceCents: 0,
  currency: "USD",
};
beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  currentPrimary = structuredClone(primary);
  generationStatus = "QUEUED";
  paid = false;
  renewal = false;
  failSave = false;
  mocks.data = {
    scope,
    primary,
    settings: null,
    options: [market],
    selection: { market, language, idCountryCode: "FR" },
    creationPricing: includedPricing,
  };
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("intent=collection-names")) return Response.json({ ok: true, intent: "collection-names", collections: [
        { id: "gid://shopify/Collection/42", title: "Men's collection" },
      ] });
      if (url.includes("intent=collections")) return Response.json({ ok: true, intent: "collections", page: {
        search: "", collections: [{ id: "gid://shopify/Collection/42", title: "Men's collection", productsCount: { count: 2, precision: "EXACT" } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } });
      if (url.includes("configuration-data"))
        return Response.json({
          ok: true,
          configuration: currentPrimary,
          feedRefreshRequired: false,
          status: { jobs: [] },
        });
      if (url.includes("resource=languages"))
        return Response.json({ ok: true, languages: [language] });
      if (options?.method === "POST") {
        const input = JSON.parse(String(options.body));
        writes.push(input);
        if (failSave)
          return Response.json(
            { ok: false, error: "Generation unavailable" },
            { status: 503 },
          );
        return Response.json({ ok: true, entry });
      }
      if (url.includes("additional-feed-billing"))
        return Response.json({
          ok: true,
          requiresRenewal: renewal,
          subscriptionId: "subscription",
          url: "https://example.com/plans",
        });
      return Response.json({
        ok: true,
        feeds: [
          {
            ...entry,
            feed: {
              ...feed,
              status: generationStatus,
              lastError: "Generation failed",
            },
          },
        ],
        usage: {
          additionalFeedCount: paid ? 5 : 0,
          entitlements: { includedAdditionalFeeds: 5 },
          nextFeedPricing: {
            ...includedPricing,
            currentAdditionalFeeds: paid ? 5 : 0,
            nextFeedIsBillable: paid,
            incrementalPriceCents: paid ? 149 : 0,
          },
        },
        activeGeneration: null,
      });
    }),
  );
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});
function setup() {
  const ui = render(
    <QueryClientProvider client={client}>
      <MarketFeedEditor />
    </QueryClientProvider>,
  );
  for (const modal of ui.container.querySelectorAll("s-modal"))
    Object.assign(modal, { showOverlay: vi.fn(), hideOverlay: vi.fn() });
  return ui.container;
}
async function change(
  element: Element,
  name: string,
  value: unknown,
  event = "change",
) {
  Object.defineProperty(element, name, {
    configurable: true,
    writable: true,
    value,
  });
  await act(async () => {
    element.dispatchEvent(new Event(event, { bubbles: true }));
  });
}
async function customize(container: Element) {
  await change(container.querySelector("s-switch")!, "checked", true);
  await waitFor(() =>
    expect(
      screen.getAllByText("Copy from Primary", { selector: "s-button" }),
    ).toHaveLength(8),
  );
}

it("first Create feed validates selection and only navigates, without any writes or XML generation", async () => {
  mocks.data.selection = null;
  const container = setup();
  fireEvent.click(screen.getByText("Create feed", { selector: "s-button" }));
  expect(mocks.navigate).not.toHaveBeenCalled();
  await change(
    container.querySelector('s-select[label="Market"]')!,
    "value",
    market.value,
  );
  await waitFor(() =>
    expect(container.querySelector('s-option[value="fr"]')).toBeTruthy(),
  );
  await change(
    container.querySelector('s-select[label="Language"]')!,
    "value",
    "fr",
  );
  fireEvent.click(screen.getByText("Create feed", { selector: "s-button" }));
  expect(mocks.navigate).toHaveBeenCalledWith(
    expect.stringContaining("/app/market-feed/configure?"),
  );
  expect(writes).toHaveLength(0);
});

it("OFF is default, presents selected context, and generates using Primary through existing API", async () => {
  const container = setup();
  expect(container.querySelector("s-switch")!.hasAttribute("checked")).toBe(
    false,
  );
  expect(container.textContent).toContain("France · France · French");
  expect(screen.queryByText("Copy from Primary")).toBeNull();
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    intent: "generate",
    customConfigurationEnabled: false,
    countryCode: "FR",
    idCountryCode: "FR",
    locale: "fr",
  });
  expect(writes[0].customConfiguration).toBeUndefined();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("enabling custom initializes from current Primary and hides all global-only settings", async () => {
  currentPrimary.excludedProductTags = ["latest-primary"];
  const container = setup();
  await customize(container);
  expect(
    container.querySelector('s-text-field[label="Alerts email"]'),
  ).toBeNull();
  expect(container.textContent).not.toContain("Color option");
  expect(container.textContent).not.toContain("Size option");
  expect(container.textContent).not.toContain("Gender & Age Rules");
  expect(container.textContent).not.toContain("Add Product type");
  expect(
    container.querySelectorAll('s-text-field[label^="Country Code"]'),
  ).toHaveLength(0);
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].customConfiguration).toMatchObject({
    excludedProductTags: ["latest-primary"],
    excludeOutOfStockItems: true,
  });
  expect(writes[0].customConfiguration).not.toHaveProperty("alertsEmail");
});

it("native checkbox updates market settings independently and turning OFF/ON retains draft values", async () => {
  const container = setup();
  await customize(container);
  await change(
    container.querySelector('s-checkbox[label="Exclude out of stock items"]')!,
    "checked",
    false,
  );
  await change(container.querySelector("s-switch")!, "checked", false);
  currentPrimary.excludeOutOfStockItems = true;
  await customize(container);
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].customConfiguration).toMatchObject({
    excludeOutOfStockItems: false,
  });
});

it("Copy from Primary reads latest section, keeps Custom ON and does not alter other custom fields", async () => {
  const container = setup();
  await customize(container);
  await change(
    container.querySelector('s-checkbox[label="Exclude out of stock items"]')!,
    "checked",
    false,
  );
  currentPrimary.excludedCollections = [
    { id: "gid://shopify/Collection/2", title: "Latest collection" },
  ];
  fireEvent.click(
    screen.getAllByText("Copy from Primary", { selector: "s-button" })[0],
  );
  await waitFor(() =>
    expect(mocks.toast.show).toHaveBeenCalledWith(
      expect.stringContaining("Copied"),
    ),
  );
  currentPrimary.excludedCollections = [];
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    customConfigurationEnabled: true,
    customConfiguration: {
      excludedCollections: [
        { id: "gid://shopify/Collection/2", title: "Latest collection" },
      ],
      excludeOutOfStockItems: false,
    },
  });
});

it("edit keeps Market/Language fixed, validates Country Code, and saves without generation", async () => {
  mocks.data.settings = {
    entry: { ...entry, feed: { ...feed, status: "COMPLETED" } },
    customConfiguration: null,
  };
  const container = setup();
  const code = container.querySelector('s-text-field[label^="Country Code"]')!;
  await change(code, "value", "invalid", "input");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(container.textContent).toContain("1-3 letter"));
  expect(writes).toHaveLength(0);
  await change(code, "value", "lb", "input");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith("/app/feeds"),
  );
  expect(writes).toEqual([
    {
      intent: "save-configuration",
      feedId: "feed",
      customConfigurationEnabled: false,
      expectedRevision: 0,
      idCountryCode: "LB",
    },
  ]);
  expect(container.querySelectorAll("s-select")).toHaveLength(0);
});

it("saved custom settings restore when re-enabled instead of being recopied", async () => {
  mocks.data.settings = {
    entry: { ...entry, feed: { ...feed, status: "COMPLETED" } },
    customConfiguration: {
      ...pickMarketConfiguration(primary),
      excludedProductTags: ["saved-custom"],
    },
  };
  const container = setup();
  currentPrimary.excludedProductTags = ["new-primary"];
  await customize(container);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].customConfiguration).toMatchObject({
    excludedProductTags: ["saved-custom"],
  });
});

it("double Generate is prevented and navigation waits for successful worker completion", async () => {
  setup();
  const generate = screen.getByText("Generate feed", { selector: "s-button" });
  fireEvent.click(generate);
  fireEvent.click(generate);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(mocks.navigate).not.toHaveBeenCalled();
  generationStatus = "COMPLETED";
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["feeds", scope.shop, scope.sessionId],
    });
  });
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith("/app/feeds"),
  );
});

it("worker failure keeps setup retryable and never presents generation as successful", async () => {
  generationStatus = "FAILED";
  const container = setup();
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() =>
    expect(container.textContent).toContain("Generation failed"),
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(
    screen
      .getByText("Generate feed", { selector: "s-button" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("queue failure displays feedback and stays on the page", async () => {
  failSave = true;
  const container = setup();
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() =>
    expect(container.textContent).toContain("Generation unavailable"),
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("paid generation retains explicit charge consent before using the existing pipeline", async () => {
  paid = true;
  const container = setup();
  const modal = container.querySelector(
    "#market-paid-confirmation",
  ) as Element & { showOverlay: () => void };
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(modal.showOverlay).toHaveBeenCalled());
  expect(writes).toHaveLength(0);
  fireEvent.click(
    screen.getByText("Add feed for $1.49/month", { selector: "s-button" }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].paidFeedConfirmed).toBe(true);
});

it("refreshes the backend quote before consent and uses that price in the notice and confirmation", async () => {
  const container = setup();
  vi.mocked(fetch).mockImplementationOnce(async () => Response.json({
    ok: true,
    feeds: [],
    usage: {
      nextFeedPricing: {
        includedAdditionalFeeds: 2,
        currentAdditionalFeeds: 2,
        nextFeedIsBillable: true,
        incrementalPriceCents: 249,
        currency: "CAD",
      },
    },
  }));
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(container.querySelector('s-banner[heading="Additional feed cost"]')?.textContent).toContain("CA$2.49/month"));
  expect(screen.getByText("Add feed for CA$2.49/month", { selector: "s-button" })).toBeTruthy();
  expect(writes).toHaveLength(0);
});

it("cancelling the paid confirmation sends no generation, renewal, or billing writes", async () => {
  paid = true;
  const container = setup();
  const modal = container.querySelector("#market-paid-confirmation") as Element & { showOverlay: () => void };
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(modal.showOverlay).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Cancel", { selector: "s-button" }));
  fireEvent.click(screen.getByText("Back to Feeds", { selector: "s-button" }));
  expect(writes).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

it("legacy paid subscription requires the existing renewal flow before generation", async () => {
  paid = true;
  renewal = true;
  const container = setup();
  const modal = container.querySelector("#market-renewal") as Element & {
    showOverlay: () => void;
  };
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(modal.showOverlay).toHaveBeenCalled());
  expect(writes).toHaveLength(0);
});

it("does not show a new-feed pricing notice when editing an existing feed", () => {
  mocks.data.settings = { entry: { ...entry, feed: { ...feed, status: "COMPLETED" } }, customConfiguration: null };
  mocks.data.creationPricing = null;
  const container = setup();
  expect(container.querySelector('s-banner[heading="Additional feed cost"]')).toBeNull();
  expect(writes).toHaveLength(0);
});

it("saves Men's collection submission mode and IDs to the specific edited market", async () => {
  mocks.data.settings = { entry: { ...entry, feed: { ...feed, status: "COMPLETED", customConfigurationEnabled: false } }, customConfiguration: null };
  const container = setup();
  await customize(container);
  fireEvent.click(screen.getByLabelText("Products from collections"));
  const modal = container.querySelector("#configuration-included-collections")!;
  await act(async () => modal.dispatchEvent(new Event("show")));
  fireEvent.click(await screen.findByText(/Men's collection/));
  fireEvent.click(modal.querySelector('s-button[slot="primary-action"]')!);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ intent: "save-configuration", feedId: feed.id, customConfigurationEnabled: true,
    customConfiguration: { productSubmissionMode: "SELECTED_COLLECTIONS", includedCollectionIds: ["gid://shopify/Collection/42"] } });
  expect(writes[0].customConfiguration).not.toHaveProperty("colorOptions");
});
it("displays collection names when reopening saved market collection selections", async () => {
  mocks.data.settings = {
    entry: { ...entry, feed: { ...feed, status: "COMPLETED", customConfigurationEnabled: true } },
    customConfiguration: {
      ...pickMarketConfiguration(primary),
      productSubmissionMode: "SELECTED_COLLECTIONS",
      includedCollectionIds: ["gid://shopify/Collection/42"],
    },
  };
  const container = setup();
  const displayedChips = () => [...container.querySelectorAll('[aria-label="Selected included collections"]')].find((element) => !element.closest("s-modal"))!;
  await waitFor(() => expect(displayedChips().textContent).toBe("Men's collection"));
  const chips = displayedChips();
  expect(chips.textContent).not.toContain("42");
  expect(writes).toHaveLength(0);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("id=gid%3A%2F%2Fshopify%2FCollection%2F42"),
    expect.any(Object),
  );
  const modal = container.querySelector("#configuration-included-collections")!;
  await act(async () => modal.dispatchEvent(new Event("show")));
  expect(modal.querySelector('[aria-label="Selected included collections"]')?.textContent).toBe("Men's collection");
});

it.each([
  ["Pro", 5, 0, false],
  ["Pro", 5, 4, false],
  ["Pro", 5, 5, true],
  ["Pro", 5, 6, true],
  ["Free", 1, 0, false],
  ["Free", 1, 1, true],
])("%s first Add Market page with allowance %i and %i Additional feeds shows paid notice: %s", (_plan, allowance, count, billable) => {
  mocks.data.selection = null;
  mocks.data.creationPricing = {
    ...includedPricing,
    includedAdditionalFeeds: allowance,
    currentAdditionalFeeds: count,
    nextFeedIsBillable: billable,
    incrementalPriceCents: billable ? 149 : 0,
  };
  const container = setup();
  const notice = container.querySelector('s-banner[heading="Additional feed cost"]');
  if (billable) {
    expect(notice?.textContent).toContain("This feed will add $1.49/month to your plan.");
    expect((notice?.compareDocumentPosition(screen.getByText("Create feed", { selector: "s-button" })) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  } else {
    expect(notice).toBeNull();
    expect(container.textContent).not.toContain("$1.49/month");
  }
  expect(writes).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("renders the backend quote's price and currency without recomputing allowances", () => {
  mocks.data.selection = null;
  mocks.data.creationPricing = {
    includedAdditionalFeeds: 2,
    currentAdditionalFeeds: 2,
    nextFeedIsBillable: true,
    incrementalPriceCents: 249,
    currency: "CAD",
  };
  const container = setup();
  expect(container.querySelector('s-banner[heading="Additional feed cost"]')?.textContent)
    .toContain("CA$2.49/month");
  expect(container.textContent).not.toContain("$1.49/month");
  expect(writes).toHaveLength(0);
});

it("backing out of a paid Add Market page only navigates, without billing or generation requests", () => {
  mocks.data.selection = null;
  mocks.data.creationPricing = { ...includedPricing, nextFeedIsBillable: true, incrementalPriceCents: 149 };
  setup();
  fireEvent.click(screen.getByText("Back to Feeds", { selector: "s-button" }));
  fireEvent.click(screen.getByText(/Feeds/, { selector: "s-link" }));
  expect(mocks.navigate).toHaveBeenCalledWith("/app/feeds");
  expect(writes).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("shows pricing on configuration before generation", () => {
  mocks.data.creationPricing = { ...includedPricing, nextFeedIsBillable: true, incrementalPriceCents: 149 };
  const container = setup();
  expect(container.querySelector('s-banner[heading="Additional feed cost"]')?.textContent).toContain("$1.49/month");
  expect(writes).toHaveLength(0);
});

it("Primary configuration input accepts three letters and normalizes typed lowercase", async () => {
  const { container } = render(<QueryClientProvider client={client}>
    <ConfigurationsPanel active scope={scope} onOpenFeeds={mocks.navigate} />
  </QueryClientProvider>);
  await waitFor(() => expect(container.querySelector('s-text-field[name="countryCode"]')?.getAttribute("value")).toBe("GB"));
  const input = container.querySelector('s-text-field[name="countryCode"]')!;
  expect(input.getAttribute("maxLength")).toBe("3");
  await change(input, "value", "lbn", "input");
  expect(input.getAttribute("value")).toBe("LBN");
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
});

it("Additional Market creation keeps three-letter product ID code separate from selected country", async () => {
  mocks.data.selection = null;
  const container = setup();
  const input = container.querySelector('s-text-field[label^="Country Code"]')!;
  expect(input.getAttribute("maxLength")).toBe("3");
  await change(input, "value", "lbn", "input");
  await change(container.querySelector('s-select[label="Market"]')!, "value", market.value);
  await waitFor(() => expect(container.querySelector('s-option[value="fr"]')).toBeTruthy());
  await change(container.querySelector('s-select[label="Language"]')!, "value", "fr");
  fireEvent.click(screen.getByText("Create feed", { selector: "s-button" }));
  const params = new URL(String(mocks.navigate.mock.calls[0][0]), "https://app.example").searchParams;
  expect(params.get("idCountryCode")).toBe("LBN");
  expect(params.get("countryCode")).toBe("FR");
  expect(writes).toHaveLength(0);
});

it.each([false, true])("Additional Market generation preserves three letters with custom configuration %s", async (customEnabled) => {
  mocks.data.selection = { market, language, idCountryCode: "FRA" };
  const container = setup();
  if (customEnabled) await customize(container);
  fireEvent.click(screen.getByText("Generate feed", { selector: "s-button" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ idCountryCode: "FRA", countryCode: "FR", customConfigurationEnabled: customEnabled });
});

it.each([false, true])("Additional Market edit saves all three letters with custom configuration %s", async (customEnabled) => {
  mocks.data.settings = { entry: { ...entry, feed: { ...feed, status: "COMPLETED" } }, customConfiguration: null };
  const container = setup();
  const input = container.querySelector('s-text-field[label^="Country Code"]')!;
  expect(input.getAttribute("maxLength")).toBe("3");
  await change(input, "value", "lbn", "input");
  if (customEnabled) await customize(container);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ intent: "save-configuration", idCountryCode: "LBN", customConfigurationEnabled: customEnabled });
});

it("shows the contextual save bar only for changed market settings and removes the footer actions", async () => {
  mocks.data.settings = {
    entry: { ...entry, feed: { ...feed, status: "COMPLETED", customConfigurationEnabled: true } },
    customConfiguration: pickMarketConfiguration(primary),
  };
  const container = setup();
  expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  expect(screen.queryByText("Back to Feeds", { selector: "s-button" })).toBeNull();
  expect(screen.queryByText("Save", { selector: "s-button" })).toBeNull();
  const checkbox = container.querySelector('s-checkbox[label="Exclude out of stock items"]')!;
  await change(checkbox, "checked", false);
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  await change(checkbox, "checked", true);
  expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  await change(container.querySelector("s-switch")!, "checked", false);
  expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(container.querySelector("s-switch")!.hasAttribute("checked")).toBe(true);
  expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  expect(writes).toHaveLength(0);
});

it("Discard restores saved country code, custom toggle, and settings copied from Primary", async () => {
  mocks.data.settings = {
    entry: { ...entry, feed: { ...feed, status: "COMPLETED", customConfigurationEnabled: true } },
    customConfiguration: pickMarketConfiguration(primary),
  };
  const container = setup();
  await change(container.querySelector('s-text-field[label^="Country Code"]')!, "value", "LB", "input");
  currentPrimary.excludeOutOfStockItems = false;
  fireEvent.click(screen.getByText("Google feed options").parentElement!.querySelector("s-button")!);
  await waitFor(() => expect(mocks.toast.show).toHaveBeenCalledWith(expect.stringContaining("Copied")));
  expect(container.querySelector('s-checkbox[label="Exclude out of stock items"]')!.hasAttribute("checked")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(container.querySelector('s-text-field[label^="Country Code"]')!.getAttribute("value")).toBe("FR");
  expect(container.querySelector('s-checkbox[label="Exclude out of stock items"]')!.hasAttribute("checked")).toBe(true);
  expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  expect(writes).toHaveLength(0);
});

it("a failed market save keeps changes available for retry or Discard", async () => {
  mocks.data.settings = {
    entry: { ...entry, feed: { ...feed, status: "COMPLETED" } },
    customConfiguration: null,
  };
  failSave = true;
  const container = setup();
  await change(container.querySelector('s-text-field[label^="Country Code"]')!, "value", "LB", "input");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(container.textContent).toContain("Generation unavailable"));
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  expect(mocks.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(container.textContent).not.toContain("Generation unavailable");
  expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
});

it("uses an internal header without s-page or Shopify breadcrumb slots", () => {
  const container = setup();
  expect(container.querySelector("s-page")).toBeNull();
  expect(container.querySelector('[slot="breadcrumb-actions"]')).toBeNull();
  expect(container.querySelector("main header")?.textContent).toContain("New market feed");
});
