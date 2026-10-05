import { queryOptions } from "@tanstack/react-query";

export const SHOPIFY_APP_STORE_URL = "https://apps.shopify.com/multi-sync-google-feed";
export interface ReviewClickStatus { clicked: boolean }
export const reviewClickKey = (shop: string) => ["shopify-review-click", shop] as const;

async function reviewRequest(method: "GET" | "POST", signal?: AbortSignal): Promise<ReviewClickStatus> {
  const response = await fetch("/app/review-click", {
    method, credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json" }, signal,
  });
  if (!response.ok) throw new Error("Your App Store visit couldn't be saved. Please try again.");
  const result = await response.json() as ReviewClickStatus;
  if (typeof result.clicked !== "boolean" || (method === "POST" && !result.clicked)) {
    throw new Error("Invalid review click response.");
  }
  return result;
}

export const recordShopifyReviewClick = () => reviewRequest("POST");
export const reviewClickQueryOptions = (shop: string) => queryOptions({
  queryKey: reviewClickKey(shop),
  queryFn: ({ signal }) => reviewRequest("GET", signal),
  staleTime: Infinity,
});
