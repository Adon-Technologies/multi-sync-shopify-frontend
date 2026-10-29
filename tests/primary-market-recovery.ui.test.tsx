import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedsPanel } from "../app/components/FeedsPanel";

vi.mock("react-router", () => ({ useNavigate: () => vi.fn(), useNavigation: () => ({ state: "idle" }) }));
vi.mock("@shopify/app-bridge-react", () => ({ useAppBridge: () => ({ toast: { show: vi.fn() } }) }));
vi.mock("../app/components/AutomaticRefreshCard", () => ({ AutomaticRefreshCard: () => null }));
const previousMarket = { id: "old", name: "Australia", countryCode: "AU", countryName: "Australia", currencyCode: "USD", currencyName: "US Dollar", locale: "en", languageName: "English" };
const replacementMarket = { ...previousMarket, id: "new", name: "United States", countryCode: "US", countryName: "United States" };
const change = { confirmationToken: "reviewed-target", previousMarket, replacementMarket };
const feed = { id: "primary", feedType: "PRIMARY", status: "FAILED", publicUrl: "https://example.com/permanent.xml", gcsObjectName: "permanent.xml", lastRefreshedAt: "2026-10-28", createdAt: "2026-10-28", updatedAt: "2026-10-28", lastError: null, processedProducts: 0, processedVariants: 0, generatedItems: 0, skippedItems: 0, fileSizeBytes: "123" };
let client: QueryClient;
let posts: RequestInit[];
const showOverlay = vi.fn();
beforeEach(() => {
  showOverlay.mockClear();
  Object.defineProperty(HTMLElement.prototype, "showOverlay", { configurable: true, value: showOverlay });
  posts = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("configuration-data")) return Response.json({ ok: true, configuration: { countryCode: "AU" } });
    if (url.includes("additional-feeds")) return Response.json({ ok: true, activeGeneration: null, feeds: [], backendUnavailable: false });
    if (options?.method === "POST") {
      posts.push(options);
      if (options.body) return Response.json({ ok: true, feed: { ...feed, status: "QUEUED" }, market: replacementMarket, activeGeneration: { feedId: "primary", feedType: "PRIMARY", label: "Primary Feed", status: "QUEUED" }, backendUnavailable: false });
      return Response.json({ ok: true, feed, market: previousMarket, marketChange: change, activeGeneration: null, backendUnavailable: false });
    }
    return Response.json({ ok: true, feed, market: previousMarket, activeGeneration: null, backendUnavailable: false });
  }));
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as HTMLElement & { showOverlay?: () => void }).showOverlay;
});

async function openPreview() {
  const view = render(<QueryClientProvider client={client}><FeedsPanel active scope={{ shop: "test.myshopify.com", sessionId: "session", locale: "en" }} /></QueryClientProvider>);
  await waitFor(() => expect(view.container.querySelector('s-button[accessibilityLabel="Refresh Primary Feed"]')).toBeTruthy());
  fireEvent.click(view.container.querySelector('s-button[accessibilityLabel="Refresh Primary Feed"]')!);
  await waitFor(() => expect(view.container.querySelector("#primary-market-change-modal")).toBeTruthy());
  expect(showOverlay).toHaveBeenCalledOnce();
  return view;
}

it("shows the old and replacement markets without queueing generation until the merchant confirms", async () => {
  const view = await openPreview();
  const modal = view.container.querySelector("#primary-market-change-modal")!;
  expect(modal.textContent).toContain("Current: Australia");
  expect(modal.textContent).toContain("Replacement: United States");
  expect(modal.textContent).toContain("feed URL will stay the same");
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toBeUndefined();
  fireEvent.click(modal.querySelector('s-button[slot="primary-action"]')!);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(JSON.parse(String(posts[1].body))).toEqual({ confirmationToken: "reviewed-target" });
  await waitFor(() => expect(view.container.querySelector("#primary-market-change-modal")).toBeNull());
  expect(view.container.textContent).toContain("United States");
});

it("cancelling the preview sends no confirmation or further request", async () => {
  const view = await openPreview();
  fireEvent.click(view.container.querySelector('#primary-market-change-modal s-button[slot="secondary-actions"]')!);
  await waitFor(() => expect(view.container.querySelector("#primary-market-change-modal")).toBeNull());
  expect(posts).toHaveLength(1);
});

it("dismissing the Polaris overlay clears the review without sending confirmation", async () => {
  const view = await openPreview();
  fireEvent(view.container.querySelector("#primary-market-change-modal")!, new Event("hide"));
  await waitFor(() => expect(view.container.querySelector("#primary-market-change-modal")).toBeNull());
  expect(posts).toHaveLength(1);
});
