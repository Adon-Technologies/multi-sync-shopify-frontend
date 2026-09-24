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
let additionalCount = 1;
let requiresRenewal = false;
let billingFailure = false;
let renewalFailure = false;
const planUrl =
  "https://admin.shopify.com/store/test/charges/app/pricing_plans";
let client: QueryClient;
const writes: Record<string, unknown>[] = [];
const hideOverlay = vi.fn();

beforeEach(() => {
  country = "GB";
  savedFeed = { ...metadata };
  additionalCount = 1;
  requiresRenewal = false;
  billingFailure = false;
  renewalFailure = false;
  writes.length = 0;
  hideOverlay.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("additional-feed-billing")) {
        if (options?.method === "POST") {
          writes.push(JSON.parse(String(options.body)));
          return renewalFailure
            ? Response.json(
                { ok: false, error: "Shopify could not confirm cancellation." },
                { status: 503 },
              )
            : Response.json({ ok: true, url: planUrl });
        }
        return billingFailure
          ? Response.json(
              { ok: false, error: "Shopify is unavailable. Try again." },
              { status: 503 },
            )
          : Response.json({
              ok: true,
              requiresRenewal,
              subscriptionId: "gid://shopify/AppSubscription/1",
              url: planUrl,
            });
      }
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
          usage: {
            additionalFeedCount: additionalCount,
            billableQuantity: Math.max(0, additionalCount - 5),
            estimatedUsageCents: Math.max(0, additionalCount - 5) * 149,
            estimatedTotalCents: 1000 + Math.max(0, additionalCount - 5) * 149,
            status: "SYNCED",
            message: null,
          },
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
  expect(
    modal
      .querySelector('s-text-field[label^="Country Code"]')
      ?.getAttribute("label"),
  ).toBe("Country Code (Primary Feed Product ID)");
  await waitFor(() =>
    expect(
      modal
        .querySelector('s-text-field[label^="Country Code"]')
        ?.getAttribute("value"),
    ).toBe("GB"),
  );
  for (const label of ["Market and country", "Language"])
    expect(
      modal
        .querySelector(`s-text-field[label="${label}"]`)
        ?.hasAttribute("readonly"),
    ).toBe(true);
  await input(modal.querySelector('s-text-field[label^="Country Code"]')!, "lb");
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
    '#edit-additional-feed-modal s-text-field[label^="Country Code"]',
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
      ...container.querySelectorAll('s-text-field[label^="Country Code"]'),
    ].filter((field) => !field.closest("s-modal"));
  await waitFor(() => expect(fields()).toHaveLength(1));
  expect(container.textContent).toContain(
    "Country Code (Primary Feed Product ID)",
  );
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
    ...container.querySelectorAll('s-text-field[label^="Country Code"]'),
  ].find((field) => !field.closest("s-modal"))!;
  await input(field, "lb");
  fireEvent.click(
    screen.getByText("Generate feed URL", { selector: "s-button" }),
  );
  await waitFor(() =>
    expect(writes[0]).toEqual({
      intent: "generate",
      paidFeedConfirmed: false,
      countryCode: "DE",
      idCountryCode: "LB",
      locale: "fr",
      marketId: "market",
    }),
  );
});

it("the sixth Additional feed requires a priced confirmation and cancel sends nothing", async () => {
  additionalCount = 5;
  const container = await setup();
  const modal = container.querySelector("#paid-additional-feed-modal")!;
  const showOverlay = vi.fn();
  Object.assign(modal, { showOverlay, hideOverlay: vi.fn() });
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
  expect(
    screen.getByText("Generate feed URL (+$1.49/month)", {
      selector: "s-button",
    }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByText("Generate feed URL (+$1.49/month)", {
      selector: "s-button",
    }),
  );
  await waitFor(() => expect(showOverlay).toHaveBeenCalledOnce());
  expect(writes).toEqual([]);
  expect(modal.querySelector('s-button[command="--hide"]')?.textContent).toBe(
    "Cancel",
  );
  await act(async () => {
    modal.dispatchEvent(new Event("hide"));
  });
  expect(writes).toEqual([]);
  fireEvent.click(
    screen.getByText("Generate feed URL (+$1.49/month)", {
      selector: "s-button",
    }),
  );
  await waitFor(() => expect(showOverlay).toHaveBeenCalledTimes(2));
  fireEvent.click(
    screen.getByText("Add feed for $1.49/month", { selector: "s-button" }),
  );
  await waitFor(() => expect(writes[0]?.paidFeedConfirmed).toBe(true));
});

async function openPaidFeedForm() {
  additionalCount = 5;
  const container = await setup();
  const renewalModal = container.querySelector(
    "#additional-feed-renewal-modal",
  )!;
  const showRenewal = vi.fn();
  const showPaid = vi.fn();
  Object.assign(renewalModal, {
    showOverlay: showRenewal,
    hideOverlay: vi.fn(),
  });
  Object.assign(container.querySelector("#paid-additional-feed-modal")!, {
    showOverlay: showPaid,
    hideOverlay: vi.fn(),
  });
  fireEvent.click(screen.getByText("+ Add Market"));
  fireEvent.click(
    await screen.findByText("Germany: Germany / EUR", { selector: "s-button" }),
  );
  fireEvent.click(
    await screen.findByText("French / FR", { selector: "s-button" }),
  );
  fireEvent.click(
    screen.getByText("Generate feed URL (+$1.49/month)", {
      selector: "s-button",
    }),
  );
  return { container, renewalModal, showRenewal, showPaid };
}

it("old subscriptions show renewal instead of paid confirmation; Not now makes no changes", async () => {
  requiresRenewal = true;
  const { renewalModal, showRenewal, showPaid } = await openPaidFeedForm();
  await waitFor(() => expect(showRenewal).toHaveBeenCalledOnce());
  expect(showPaid).not.toHaveBeenCalled();
  expect(renewalModal.textContent).toContain(
    "Cancellation takes effect immediately",
  );
  expect(renewalModal.textContent).toContain("$1.49/month");
  fireEvent.click(screen.getByText("Not now", { selector: "s-button" }));
  expect(renewalModal.querySelector('s-button[command="--hide"]')).toBeTruthy();
  expect(writes).toEqual([]);
});

it("explicit resubscription sends one cancellation request and opens Shopify, never generates a feed", async () => {
  requiresRenewal = true;
  const navigate = vi.spyOn(window, "open").mockImplementation(() => null);
  const { showRenewal } = await openPaidFeedForm();
  await waitFor(() => expect(showRenewal).toHaveBeenCalledOnce());
  const confirm = screen.getByText("Cancel and resubscribe", {
    selector: "s-button",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(planUrl, "_top"));
  expect(writes).toEqual([
    { confirmed: true, subscriptionId: "gid://shopify/AppSubscription/1" },
  ]);
  expect(
    screen.getByText("Open Shopify plan selection").getAttribute("href"),
  ).toBe(planUrl);
  navigate.mockRestore();
});

it("verification outages never offer cancellation", async () => {
  billingFailure = true;
  const { showRenewal, showPaid } = await openPaidFeedForm();
  await screen.findByText("Shopify is unavailable. Try again.");
  expect(showRenewal).not.toHaveBeenCalled();
  expect(showPaid).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

it("uncertain cancellation keeps the explanation and offers the Shopify recovery link", async () => {
  requiresRenewal = true;
  renewalFailure = true;
  const { showRenewal } = await openPaidFeedForm();
  await waitFor(() => expect(showRenewal).toHaveBeenCalledOnce());
  fireEvent.click(
    screen.getByText("Cancel and resubscribe", { selector: "s-button" }),
  );
  await screen.findByText("Shopify could not confirm cancellation.");
  expect(
    screen.getByText("Open Shopify plan selection").getAttribute("href"),
  ).toBe(planUrl);
  expect(writes).toHaveLength(1);
});

it("keeps Additional feeds visible without pricing or usage copy", async () => {
  additionalCount = 24;
  const container = await setup();
  expect(screen.getByText("Additional Market feeds", { selector: "s-heading" })).toBeTruthy();
  expect(screen.getByText(/Create localized Google feeds for specific Shopify Markets/)).toBeTruthy();
  expect(screen.getByText("Additional feed")).toBeTruthy();
  expect(container.querySelector('a[href="https://example.com/feed.xml"]')).toBeTruthy();
  expect(screen.queryByText(/5 Additional Market feeds included with Pro/)).toBeNull();
  expect(screen.queryByText(/Estimated additional usage:/)).toBeNull();
});

it("Cancel hides the edit dialog without saving", async () => {
  const container = await setup();
  fireEvent.click(container.querySelector('s-button[icon="edit"]')!);
  const modal = container.querySelector("#edit-additional-feed-modal")!;
  await waitFor(() =>
    expect(
      modal
        .querySelector('s-text-field[label^="Country Code"]')
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
