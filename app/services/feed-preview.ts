export interface ProductFeedPreview {
  ok: true;
  productId: string;
  productTitle: string;
  feedType: "PRIMARY";
  status: "included" | "not-in-feed";
  xml: string | null;
  itemCount: number;
  message: string | null;
}

export async function requestProductFeedPreview(productId: string, signal: AbortSignal): Promise<ProductFeedPreview> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(55_000)]);
  let response: Response;
  try { response = await fetch("/app/feed-preview", {
    method: "POST", credentials: "same-origin", cache: "no-store", signal: requestSignal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  }); } catch {
    throw new Error(requestSignal.aborted && !signal.aborted ? "XML preview timed out. Close the dialog and try again." : "XML preview couldn't be loaded. Close the dialog and try again.");
  }
  const data = await response.json().catch(() => null) as ProductFeedPreview | { error?: string } | null;
  if (!response.ok || !data || !("ok" in data) || !data.ok) {
    throw new Error(data && "error" in data && typeof data.error === "string" ? data.error : "XML preview couldn't be generated. Close the dialog and try again.");
  }
  if (data.productId !== productId || data.feedType !== "PRIMARY" ||
      !["included", "not-in-feed"].includes(data.status) ||
      (data.status === "included" ? typeof data.xml !== "string" || !data.xml : data.xml !== null)) {
    throw new Error("XML preview couldn't be generated. Close the dialog and try again.");
  }
  return data;
}
