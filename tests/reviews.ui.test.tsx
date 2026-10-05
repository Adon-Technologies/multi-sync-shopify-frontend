import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanReviewBanner } from "../app/components/ReviewBanner";
import { SHOPIFY_APP_STORE_URL, reviewClickKey } from "../app/services/shopify-reviews";

const shop = "test.myshopify.com";
let clicked: boolean;
let request: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.spyOn>;
let nativeReview: ReturnType<typeof vi.fn>;
const clients: QueryClient[] = [];
beforeEach(() => {
  clicked = false;
  request = vi.fn(async (_url: string, options: RequestInit) => {
    if (options.method === "POST") clicked = true;
    return Response.json({ clicked });
  });
  vi.stubGlobal("fetch", request);
  nativeReview = vi.fn();
  vi.stubGlobal("shopify", { reviews: { request: nativeReview } });
  open = vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => { clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });

function setup(domain: string | null = shop) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retryDelay: 0 } } });
  clients.push(client);
  const view = render(<QueryClientProvider client={client}><PlanReviewBanner shop={domain} /></QueryClientProvider>);
  return { ...view, client };
}
const stars = () => screen.findAllByRole("button", { name: /^Rate \d out of 5$/ });

describe("App Store review clicks", () => {
  it("keeps accessible hover previews and keyboard navigation", async () => {
    setup();
    const buttons = await stars();
    fireEvent.mouseEnter(buttons[3]);
    expect(buttons.map(button => button.dataset.highlighted)).toEqual(["true", "true", "true", "true", "false"]);
    fireEvent.mouseLeave(screen.getByRole("group", { name: "Rate your experience" }));
    expect(buttons.every(button => button.dataset.highlighted === "false")).toBe(true);
    act(() => buttons[0].focus());
    for (const [key, index] of [["ArrowRight", 1], ["End", 4], ["ArrowRight", 0], ["ArrowLeft", 4], ["Home", 0]] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBe(buttons[index]);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4, 5])("star %i opens the same listing immediately and persists only a click", async value => {
    const { client } = setup();
    let finish!: (value: Response) => void;
    const buttons = await stars();
    request.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    fireEvent.click(buttons[value - 1]);
    expect(open).toHaveBeenCalledExactlyOnceWith(SHOPIFY_APP_STORE_URL, "_blank", "noopener,noreferrer");
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [url, options] = request.mock.calls[1];
    expect(url).toBe("/app/review-click");
    expect(options.method).toBe("POST");
    expect(options.body).toBeUndefined();
    expect(screen.queryByText("How is your experience with Multi Sync?")).toBeNull();
    expect(client.getQueryData(reviewClickKey(shop))).toEqual({ clicked: true });
    await act(async () => finish(Response.json({ clicked: true })));
    expect(nativeReview).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/submitted|thank you|review form/i)).toBeNull();
  });

  it("hides the banner on reload using server state and does not open the listing again", async () => {
    const first = setup();
    fireEvent.click((await stars())[0]);
    await waitFor(() => expect(clicked).toBe(true));
    first.unmount();
    const second = setup();
    await waitFor(() => expect(second.client.getQueryData(reviewClickKey(shop))).toEqual({ clicked: true }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shares dismissal across dashboard, plan and support remounts", async () => {
    const first = setup();
    const buttons = await stars();
    fireEvent.click(buttons[0]); fireEvent.click(buttons[4]);
    await waitFor(() => expect(clicked).toBe(true));
    first.rerender(<QueryClientProvider client={first.client}><PlanReviewBanner key="plan" shop={shop} /></QueryClientProvider>);
    expect(screen.queryByRole("group")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });

  it("keeps another store's banner independent", async () => {
    const first = setup();
    fireEvent.click((await stars())[0]);
    await waitFor(() => expect(clicked).toBe(true));
    clicked = false;
    first.rerender(<QueryClientProvider client={first.client}><PlanReviewBanner key="other" shop="other.myshopify.com" /></QueryClientProvider>);
    expect(await stars()).toHaveLength(5);
    expect(first.client.getQueryData(reviewClickKey(shop))).toEqual({ clicked: true });
  });

  it("restores a retryable banner when persistence fails without claiming a saved click", async () => {
    setup();
    const buttons = await stars();
    request.mockResolvedValue(Response.json({ error: "Sensitive database detail" }, { status: 503 }));
    fireEvent.click(buttons[0]);
    expect(await screen.findByText("Your App Store visit couldn't be saved. Please try again.")).toBeTruthy();
    expect(screen.queryByText(/Sensitive database detail/)).toBeNull();
    request.mockImplementation(async () => { clicked = true; return Response.json({ clicked: true }); });
    fireEvent.click((await stars())[1]);
    await waitFor(() => expect(clicked).toBe(true));
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("doesn't save a click if external navigation throws", async () => {
    setup();
    open.mockImplementation(() => { throw new Error("Navigation unavailable"); });
    fireEvent.click((await stars())[0]);
    expect(await screen.findByText("The Shopify App Store couldn't be opened. Please try again.")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("doesn't flash the banner before checking persisted status", async () => {
    request.mockImplementation(() => new Promise(() => {}));
    setup();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("does not query or render without an authenticated store scope", () => {
    setup(null);
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).toBeNull();
  });
});
