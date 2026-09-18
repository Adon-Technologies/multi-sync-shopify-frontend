// AppProvider installs this App Bridge global; useAppBridge returns the same
// instance. Resolve it at interaction time so a missing bridge cannot crash
// the banner during rendering (and no browser API is accessed during SSR).
export async function requestShopifyReview(): Promise<"displayed" | "not-displayed" | "already-opening"> {
  try {
    const shopify = typeof window === "undefined" ? undefined : window.shopify;
    if (typeof shopify?.reviews?.request !== "function") {
      if (import.meta.env.DEV) console.debug("[Multi Sync reviews] App Bridge Reviews API unavailable.");
      return "not-displayed";
    }
    // No selected rating, message, or other arguments are sent to Shopify.
    const response = await shopify.reviews.request();
    if (response.success === true) return "displayed"; // Display only, never submission.
    if (import.meta.env.DEV) console.debug("[Multi Sync reviews] Modal not displayed:", response.code);
    if (response.code === "already-open" || response.code === "open-in-progress") return "already-opening";
    return "not-displayed";
  } catch {
    // Network failures and missing/unsupported bridge implementations are
    // non-fatal. Never expose Shopify errors or inspect review content.
    if (import.meta.env.DEV) console.debug("[Multi Sync reviews] Review request failed.");
    return "not-displayed";
  }
}
