import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanReviewBanner } from "../app/components/ReviewBanner";

const requestReview = vi.fn();
beforeEach(() => {
  requestReview.mockReset().mockResolvedValue({ success: true, code: "success", message: "Review modal shown successfully" });
  vi.stubGlobal("shopify", { reviews: { request: requestReview } });
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected application request"));
  vi.spyOn(Storage.prototype, "setItem");
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  render(<PlanReviewBanner />);
  return screen.getAllByRole("button", { name: /^Rate \d out of 5$/ });
}
function status() { return screen.getByRole("status", { name: "Shopify review request" }); }
function expectNoPrivateFlow() {
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(/private feedback/i)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(Storage.prototype.setItem).not.toHaveBeenCalled();
}

describe("Shopify Plan reviews", () => {
  it("renders five accessible stars, previews hover, restores selection and supports keyboard navigation", async () => {
    const stars = setup();
    expect(screen.getByText("How is your experience with Multi Sync?")).toBeTruthy();
    expect(stars).toHaveLength(5);
    fireEvent.mouseEnter(stars[3]);
    expect(stars.map(star => star.dataset.highlighted)).toEqual(["true", "true", "true", "true", "false"]);
    fireEvent.mouseLeave(screen.getByRole("group", { name: "Rate your experience" }));
    expect(stars.every(star => star.dataset.highlighted === "false")).toBe(true);
    act(() => stars[0].focus());
    for (const [key, index] of [["ArrowRight", 1], ["End", 4], ["ArrowRight", 0], ["ArrowLeft", 4], ["Home", 0]] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBe(stars[index]);
    }
    expect(requestReview).not.toHaveBeenCalled();
    fireEvent.click(stars[2]);
    await waitFor(() => expect(stars[2].getAttribute("aria-disabled")).toBe("false"));
    fireEvent.mouseEnter(stars[4]);
    fireEvent.mouseLeave(screen.getByRole("group", { name: "Rate your experience" }));
    expect(stars.map(star => star.dataset.highlighted)).toEqual(["true", "true", "true", "false", "false"]);
    expectNoPrivateFlow();
  });

  it.each([1, 2, 3, 4, 5])("requests Shopify for star %i without transferring or storing its value", async rating => {
    const stars = setup();
    fireEvent.click(stars[rating - 1]);
    await waitFor(() => expect(stars[0].getAttribute("aria-disabled")).toBe("false"));
    expect(requestReview).toHaveBeenCalledExactlyOnceWith();
    expect(status().textContent).toBe("");
    expect(screen.queryByText(/submitted|thank you/i)).toBeNull();
    expectNoPrivateFlow();
  });

  it.each(["already-reviewed", "cooldown-period", "merchant-ineligible", "annual-limit-reached", "recently-installed", "mobile-app", "cancelled"])("keeps the Plan usable for Shopify decline: %s", async code => {
    requestReview.mockResolvedValue({ success: false, code, message: "Technical Shopify detail" });
    const stars = setup();
    fireEvent.click(stars[0]);
    await waitFor(() => expect(status().textContent).toContain("You can continue using Multi Sync."));
    expect(document.body.textContent).not.toContain(code);
    expect(document.body.textContent).not.toContain("Technical Shopify detail");
    expect(stars[0].getAttribute("aria-disabled")).toBe("false");
    expectNoPrivateFlow();
  });

  it.each(["already-open", "open-in-progress"])("handles %s without reporting a review submission", async code => {
    requestReview.mockResolvedValue({ success: false, code, message: "Not displayed" });
    fireEvent.click(setup()[0]);
    await waitFor(() => expect(status().textContent).toBe("Continue your review in Shopify."));
    expectNoPrivateFlow();
  });

  it.each(["bridge", "reviews", "network", "invalid-response"])("handles unavailable %s without a broken banner", async failure => {
    if (failure === "bridge") vi.stubGlobal("shopify", undefined);
    if (failure === "reviews") vi.stubGlobal("shopify", {});
    if (failure === "network") requestReview.mockRejectedValue(new Error("Sensitive network details"));
    if (failure === "invalid-response") requestReview.mockResolvedValue(undefined);
    const stars = setup();
    fireEvent.click(stars[0]);
    await waitFor(() => expect(status().textContent).toContain("isn’t available right now"));
    expect(document.body.textContent).not.toContain("Sensitive network details");
    expect(stars[0].getAttribute("aria-disabled")).toBe("false");
    expectNoPrivateFlow();
  });

  it("blocks concurrent requests and allows another attempt after completion", async () => {
    let finish!: (value: object) => void;
    requestReview.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const stars = setup();
    fireEvent.click(stars[0]); fireEvent.click(stars[4]);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(stars[0].getAttribute("aria-disabled")).toBe("true");
    await act(async () => finish({ success: false, code: "cancelled", message: "Cancelled" }));
    fireEvent.click(stars[4]);
    await waitFor(() => expect(requestReview).toHaveBeenCalledTimes(2));
    expectNoPrivateFlow();
  });

  it("uses Shopify's development-store preview response without claiming publication or reading review content", async () => {
    const response = { success: true, code: "success", message: "Review modal shown successfully" };
    const forbidden = vi.fn(() => { throw new Error("Review content is not available"); });
    Object.defineProperties(response, { rating: { get: forbidden }, review: { get: forbidden }, submitted: { get: forbidden } });
    requestReview.mockResolvedValue(response);
    fireEvent.click(setup()[1]);
    await waitFor(() => expect(status().textContent).toBe(""));
    expect(forbidden).not.toHaveBeenCalled();
    expect(screen.queryByText(/submitted|published/i)).toBeNull();
    expectNoPrivateFlow();
  });
});
