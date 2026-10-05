import { beforeEach, expect, it, vi } from "vitest";
import { requestProductFeedPreview } from "../app/services/feed-preview";
const productId = "gid://shopify/Product/1";
const result = { ok: true, productId, productTitle: "Product", feedType: "PRIMARY", status: "included", xml: "<rss/>", itemCount: 1, message: null };
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockImplementation(async () => Response.json(result)); });
it("sends a fresh no-store Primary preview request on each call", async () => {
  for (let i = 0; i < 2; i++) expect(await requestProductFeedPreview(productId, new AbortController().signal)).toEqual(result);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledWith("/app/feed-preview", expect.objectContaining({ method: "POST", cache: "no-store", credentials: "same-origin", body: JSON.stringify({ productId }), signal: expect.any(AbortSignal) }));
});
it.each([{ ...result, productId: "gid://shopify/Product/2" }, { ...result, feedType: "ADDITIONAL" }, { ...result, xml: null }, { ...result, status: "invalid" }])("rejects wrong-product, wrong-feed and malformed responses", async data => {
  fetchMock.mockResolvedValue(Response.json(data));
  await expect(requestProductFeedPreview(productId, new AbortController().signal)).rejects.toThrow("couldn't be generated");
});
it("reports safe backend failures and invalid/non-JSON responses", async () => {
  fetchMock.mockResolvedValue(Response.json({ ok: false, error: "This product is no longer available in Shopify." }, { status: 404 }));
  await expect(requestProductFeedPreview(productId, new AbortController().signal)).rejects.toThrow("no longer available");
  fetchMock.mockResolvedValue(new Response("server error", { status: 502 }));
  await expect(requestProductFeedPreview(productId, new AbortController().signal)).rejects.toThrow("couldn't be generated");
});
it("timeout aborts network work with a friendly error", async () => {
  const controller = new AbortController(); controller.abort(new DOMException("timeout", "TimeoutError"));
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  fetchMock.mockRejectedValue(new DOMException("network aborted", "AbortError"));
  await expect(requestProductFeedPreview(productId, new AbortController().signal)).rejects.toThrow("timed out");
});
