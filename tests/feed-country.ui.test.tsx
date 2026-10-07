import { feedKeys } from "../app/services/feed-query";
import { updateMarketFeedCache } from "../app/services/market-configuration-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedsPanel } from "../app/components/FeedsPanel";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: { show: vi.fn() },
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({ toast: mocks.toast }),
}));
vi.mock("../app/components/AutomaticRefreshCard", () => ({
  AutomaticRefreshCard: () => null,
}));
const scope = {
  shop: "test.myshopify.com",
  sessionId: "session",
  locale: "en",
};
const market = {
  id: "market",
  name: "Germany",
  countryCode: "DE",
  countryName: "Germany",
  currencyCode: "EUR",
  languageName: "German",
  locale: "de",
};
const metadata = {
  id: "feed",
  feedType: "ADDITIONAL",
  idCountryCode: "GB",
  status: "COMPLETED",
  requiresRefresh: false,
  lastRefreshedAt: "2026-09-01",
  publicUrl: "https://example.com/feed.xml",
  generatedItems: 1,
  gcsObjectName: "feed.xml",
  fileSizeBytes: "100",
  marketConfigurationRevision: 0,
};
let savedFeed: typeof metadata & { customConfigurationEnabled?: boolean };
let client: QueryClient;
let failure: boolean;
let deferred: (() => void) | null;
const writes: Record<string, unknown>[] = [];
beforeEach(() => {
  savedFeed = { ...metadata };
  writes.length = 0;
  failure = false;
  deferred = null;
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const input = JSON.parse(String(options.body));
        writes.push(input);
        if (deferred !== null)
          await new Promise<void>((resolve) => {
            deferred = resolve;
          });
        if (failure)
          return Response.json(
            { ok: false, error: "Save failed" },
            { status: 503 },
          );
        savedFeed = {
          ...savedFeed,
          customConfigurationEnabled: input.customConfigurationEnabled,
          requiresRefresh: true,
          marketConfigurationRevision: 1,
        };
        return Response.json({ ok: true, entry: { feed: savedFeed, market } });
      }
      if (url.includes("configuration-data"))
        return Response.json({
          ok: true,
          configuration: { countryCode: "GB" },
          feedRefreshRequired: savedFeed.requiresRefresh,
        });
      if (url.includes("additional-feeds"))
        return Response.json({
          ok: true,
          activeGeneration: null,
          backendUnavailable: false,
          feeds: [{ feed: savedFeed, market }],
        });
      return Response.json({
        ok: true,
        feed: { ...metadata, id: "primary", feedType: "PRIMARY" },
        market,
        activeGeneration: null,
        backendUnavailable: false,
      });
    }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});
async function setup() {
  const ui = render(
    <QueryClientProvider client={client}>
      <FeedsPanel active scope={scope} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(ui.container.querySelector('s-button[icon="edit"]')).toBeTruthy(),
  );
  return ui.container;
}
async function toggle(element: Element, checked: boolean) {
  Object.defineProperty(element, "checked", {
    configurable: true,
    writable: true,
    value: checked,
  });
  await act(async () => {
    fireEvent.change(element);
  });
}
it("Add Market and Edit navigate to dedicated pages with no old dialogs or inline forms", async () => {
  const container = await setup();
  fireEvent.click(screen.getByText("+ Add Market", { selector: "s-button" }));
  expect(mocks.navigate).toHaveBeenCalledWith("/app/market-feed/new");
  fireEvent.click(container.querySelector('s-button[icon="edit"]')!);
  expect(mocks.navigate).toHaveBeenCalledWith("/app/market-feed/feed");
  expect(container.querySelector("#edit-additional-feed-modal")).toBeNull();
  expect(container.querySelectorAll("s-switch")).toHaveLength(1);
  expect(writes).toEqual([]);
});
it("legacy rows show custom OFF and confirmed toggle marks only that row Refresh required", async () => {
  const container = await setup();
  const control = container.querySelector("s-switch")!;
  expect(control.hasAttribute("checked")).toBe(false);
  await toggle(control, true);
  await waitFor(() => expect(control.hasAttribute("checked")).toBe(true));
  expect(writes).toEqual([
    {
      intent: "toggle-configuration",
      feedId: "feed",
      customConfigurationEnabled: true,
      expectedRevision: 0,
    },
  ]);
  expect(
    screen.getAllByText("Refresh required", { selector: "s-badge" }),
  ).toHaveLength(1);
});
it("failed switch request returns to saved OFF state and shows Polaris feedback", async () => {
  failure = true;
  const container = await setup();
  const control = container.querySelector("s-switch")!;
  await toggle(control, true);
  await waitFor(() =>
    expect(
      container.querySelector('s-banner[heading="Save failed"]'),
    ).toBeTruthy(),
  );
  expect(control.hasAttribute("checked")).toBe(false);
  expect((control as Element & { checked: boolean }).checked).toBe(false);
});
it("rapid toggles are disabled until the server confirms, preventing duplicate saves", async () => {
  deferred = () => {};
  const container = await setup();
  const control = container.querySelector("s-switch")!;
  await toggle(control, true);
  await waitFor(() => expect(control.hasAttribute("disabled")).toBe(true));
  await toggle(control, false);
  expect(writes).toHaveLength(1);
  await act(async () => {
    deferred?.();
  });
  await waitFor(() => expect(control.hasAttribute("checked")).toBe(true));
});

it("returning from the editor immediately shows the saved Refresh required badge from an inactive cached feed list", async () => {
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, refetchOnMount: false } });
  const key = feedKeys.additional(scope, "/app/additional-feeds");
  const other = { feed: { ...metadata, id: "unrelated" }, market };
  client.setQueryData(key, { ok: true, feeds: [{ feed: { ...metadata }, market }, other], activeGeneration: null, backendUnavailable: false });
  const saved = { feed: { ...metadata, requiresRefresh: true, customConfigurationEnabled: true, marketConfigurationRevision: 1 }, market };
  updateMarketFeedCache(client, scope, { ok: true, entry: saved });
  await setup();
  expect(screen.getAllByText("Refresh required", { selector: "s-badge" })).toHaveLength(1);
  expect(client.getQueryData(key)).toMatchObject({ feeds: [saved, other] });
  expect(writes).toEqual([]);
});
