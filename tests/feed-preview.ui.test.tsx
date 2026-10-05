import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProductFeedPreviewModal } from "../app/components/ProductFeedPreview";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../app/services/feed-preview", () => ({ requestProductFeedPreview: api.request }));
const target = { id: "gid://shopify/Product/1", title: "Product & title" };
const xml = '<?xml version="1.0"?>\n<rss><item><g:title>A &amp; B</g:title></item>\n<item>Second variant</item></rss>';
const result = { ok: true, productId: target.id, productTitle: target.title, feedType: "PRIMARY", status: "included", xml, itemCount: 2, message: null };
beforeEach(() => { api.request.mockReset(); api.request.mockResolvedValue(result); });
function button(container: HTMLElement, text: string) { return [...container.querySelectorAll("s-button")].find(b => b.textContent === text)!; }
it("does no work until opened, immediately loads and safely displays complete XML", async () => {
  let finish!: (value: typeof result) => void;
  api.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const close = vi.fn();
  const view = render(<ProductFeedPreviewModal target={null} onClose={close} />);
  expect(api.request).not.toHaveBeenCalled();
  view.rerender(<ProductFeedPreviewModal target={target} onClose={close} />);
  expect(view.container.querySelector("s-spinner")).not.toBeNull();
  expect(button(view.container, "Copy XML").hasAttribute("disabled")).toBe(true);
  await act(async () => { finish(result); });
  expect(view.container.querySelector("pre")?.textContent).toBe(xml);
  expect(view.container.querySelector("g\\:title")).toBeNull();
  expect(view.container.querySelector("s-modal")?.getAttribute("heading")).toBe("XML Preview");
  expect(view.container.textContent).toContain("Primary Feed");
});
it("copies all variants and the complete XML string", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const view = render(<ProductFeedPreviewModal target={target} onClose={vi.fn()} />);
  await waitFor(() => expect(view.container.querySelector("pre")).not.toBeNull());
  fireEvent.click(button(view.container, "Copy XML"));
  await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith(xml));
  expect(await view.findByRole("status")).toHaveProperty("textContent", "XML copied.");
});
it("closing discards XML and reopening requests fresh data", async () => {
  const close = vi.fn();
  const view = render(<ProductFeedPreviewModal target={target} onClose={close} />);
  await waitFor(() => expect(view.container.querySelector("pre")).not.toBeNull());
  fireEvent.click(button(view.container, "Close")); expect(close).toHaveBeenCalled();
  view.rerender(<ProductFeedPreviewModal target={null} onClose={close} />);
  expect(view.container.querySelector("pre")).toBeNull();
  expect((api.request.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  api.request.mockResolvedValue({ ...result, xml: "<rss>Fresh XML</rss>" });
  view.rerender(<ProductFeedPreviewModal target={{ ...target }} onClose={close} />);
  await waitFor(() => expect(view.container.querySelector("pre")?.textContent).toBe("<rss>Fresh XML</rss>"));
  expect(api.request).toHaveBeenCalledTimes(2);
});
it("closing cancels pending work and ignores its late result", async () => {
  let finish!: (value: typeof result) => void;
  api.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const close = vi.fn();
  const view = render(<ProductFeedPreviewModal target={target} onClose={close} />);
  view.rerender(<ProductFeedPreviewModal target={null} onClose={close} />);
  expect((api.request.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  await act(async () => { finish(result); });
  expect(view.container.querySelector("pre")).toBeNull();
});
it("Polaris overlay dismissal closes the preview", async () => {
  const close = vi.fn();
  const view = render(<ProductFeedPreviewModal target={target} onClose={close} />);
  fireEvent(view.container.querySelector("s-modal")!, new Event("hide"));
  expect(close).toHaveBeenCalled();
});
it.each(["This product is no longer available in Shopify.", "XML preview timed out. Close the dialog and try again."])("shows a closable Polaris error: %s", async message => {
  api.request.mockRejectedValue(new Error(message));
  const close = vi.fn();
  const view = render(<ProductFeedPreviewModal target={target} onClose={close} />);
  await waitFor(() => expect(view.container.querySelector('s-banner[tone="critical"]')?.textContent).toBe(message));
  expect(view.container.querySelector("pre")).toBeNull();
  fireEvent.click(button(view.container, "Close")); expect(close).toHaveBeenCalled();
});
it("excluded products have a clear state and cannot copy fake XML", async () => {
  api.request.mockResolvedValue({ ...result, status: "not-in-feed", xml: null, message: "This product is not currently included in the Primary Feed." });
  const view = render(<ProductFeedPreviewModal target={target} onClose={vi.fn()} />);
  await waitFor(() => expect(view.container.querySelector('s-banner[tone="info"]')?.textContent).toContain("not currently included"));
  expect(button(view.container, "Copy XML").hasAttribute("disabled")).toBe(true);
  expect(view.container.querySelector("pre")).toBeNull();
});
