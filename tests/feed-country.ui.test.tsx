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

const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("@shopify/app-bridge-react", () => ({
  useAppBridge: () => ({ toast }),
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
};
let country = "GB";
let savedFeed = { ...metadata };
let client: QueryClient;
const writes: Record<string, unknown>[] = [];
const hideOverlay = vi.fn();

beforeEach(() => {
  country = "GB";
  savedFeed = { ...metadata };
  writes.length = 0;
  hideOverlay.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const input = JSON.parse(String(options.body));
        writes.push(input);
        savedFeed = {
          ...savedFeed,
          idCountryCode: input.idCountryCode,
          requiresRefresh: true,
        };
        return Response.json({ ok: true, entry: { feed: savedFeed, market } });
      }
      if (url.includes("configuration-data"))
        return Response.json({
          ok: true,
          configuration: { countryCode: country },
          feedRefreshRequired: savedFeed.requiresRefresh,
        });
      if (url.includes("resource=markets"))
        return Response.json({
          ok: true,
          options: [
            {
              marketId: "market",
              marketName: "Germany",
              countryCode: "DE",
              countryName: "Germany",
              currencyCode: "EUR",
              value: "market|DE",
              availableLanguageCount: 1,
            },
          ],
        });
      if (url.includes("resource=languages"))
        return Response.json({
          ok: true,
          languages: [{ locale: "fr", name: "French" }],
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
  const result = render(
    <QueryClientProvider client={client}>
      <FeedsPanel active scope={scope} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      result.container.querySelector('s-button[icon="edit"]'),
    ).toBeTruthy(),
  );
  const modal = result.container.querySelector("#edit-additional-feed-modal")!;
  Object.assign(modal, { showOverlay: vi.fn(), hideOverlay });
  return result.container;
}
async function input(element: Element, value: string) {
  Object.defineProperty(element, "value", {
    configurable: true,
    writable: true,
    value,
  });
  await act(async () => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("offers edit only on Additional feeds, saves only Country Code, and shows Refresh required", async () => {
  const container = await setup();
  const editButtons = container.querySelectorAll('s-button[icon="edit"]');
  expect(editButtons).toHaveLength(1);
  fireEvent.click(editButtons[0]);
  const modal = container.querySelector("#edit-additional-feed-modal")!;
  await waitFor(() =>
    expect(
      modal
        .querySelector('s-text-field[label="Country Code"]')
        ?.getAttribute("value"),
    ).toBe("GB"),
  );
  for (const label of ["Market and country", "Language"])
    expect(
      modal
        .querySelector(`s-text-field[label="${label}"]`)
        ?.hasAttribute("readonly"),
    ).toBe(true);
  await input(modal.querySelector('s-text-field[label="Country Code"]')!, "lb");
  fireEvent.click(screen.getByText("Save", { selector: "s-button" }));
  await waitFor(() =>
    expect(writes).toEqual([
      { intent: "edit", feedId: "feed", idCountryCode: "LB" },
    ]),
  );
  await waitFor(() =>
    expect(
      screen.getByText("Refresh required", { selector: "s-badge" }),
    ).toBeTruthy(),
  );
  expect(hideOverlay).toHaveBeenCalledOnce();
});

it("validates edits before sending and keeps the dialog open", async () => {
  const container = await setup();
  fireEvent.click(container.querySelector('s-button[icon="edit"]')!);
  const field = container.querySelector(
    '#edit-additional-feed-modal s-text-field[label="Country Code"]',
  )!;
  await waitFor(() => expect(field.getAttribute("value")).toBe("GB"));
  await input(field, "  ");
  fireEvent.click(screen.getByText("Save", { selector: "s-button" }));
  expect(field.getAttribute("error")).toMatch(/two-letter/);
  expect(writes).toEqual([]);
  expect(hideOverlay).not.toHaveBeenCalled();
});

it("each Add Market form snapshots current Configuration and keeps its override", async () => {
  const container = await setup();
  fireEvent.click(screen.getByText("+ Add Market"));
  const fields = () =>
    [
      ...container.querySelectorAll('s-text-field[label="Country Code"]'),
    ].filter((field) => !field.closest("s-modal"));
  await waitFor(() => expect(fields()).toHaveLength(1));
  expect(fields()[0].getAttribute("value")).toBe("GB");
  await input(fields()[0], "lb");
  country = "US";
  fireEvent.click(screen.getByText("+ Add Market"));
  await waitFor(() => expect(fields()).toHaveLength(2));
  expect(fields().map((field) => field.getAttribute("value"))).toEqual([
    "LB",
    "US",
  ]);
});

it("Generate feed URL submits the override without replacing the Shopify market country", async () => {
  const container = await setup();
  fireEvent.click(screen.getByText("+ Add Market"));
  await waitFor(() =>
    expect(
      screen.queryByText("Germany: Germany / EUR", { selector: "s-button" }),
    ).toBeTruthy(),
  );
  fireEvent.click(
    screen.getByText("Germany: Germany / EUR", { selector: "s-button" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText("French / FR", { selector: "s-button" }),
    ).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("French / FR", { selector: "s-button" }));
  const field = [
    ...container.querySelectorAll('s-text-field[label="Country Code"]'),
  ].find((field) => !field.closest("s-modal"))!;
  await input(field, "lb");
  fireEvent.click(
    screen.getByText("Generate feed URL", { selector: "s-button" }),
  );
  await waitFor(() =>
    expect(writes[0]).toEqual({
      intent: "generate",
      countryCode: "DE",
      idCountryCode: "LB",
      locale: "fr",
      marketId: "market",
    }),
  );
});

it("Cancel hides the edit dialog without saving", async () => {
  const container = await setup();
  fireEvent.click(container.querySelector('s-button[icon="edit"]')!);
  const modal = container.querySelector("#edit-additional-feed-modal")!;
  await waitFor(() =>
    expect(
      modal
        .querySelector('s-text-field[label="Country Code"]')
        ?.getAttribute("value"),
    ).toBe("GB"),
  );
  const cancel = [...modal.querySelectorAll("s-button")].find(
    (button) => button.textContent === "Cancel",
  )!;
  expect(cancel.getAttribute("command")).toBe("--hide");
  expect(cancel.getAttribute("commandfor")).toBe("edit-additional-feed-modal");
  await act(async () => {
    modal.dispatchEvent(new Event("hide"));
  });
  expect(writes).toEqual([]);
  expect(
    modal
      .querySelector('s-button[slot="primary-action"]')
      ?.getAttribute("disabled"),
  ).toBe("true");
});
