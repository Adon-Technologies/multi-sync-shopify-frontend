import type { QueryClient } from "@tanstack/react-query";
import type { AdditionalFeedActionResponse, AdditionalFeedsResponse } from "../routes/app.additional-feeds";
import { feedKeys, type FeedQueryScope } from "./feed-query";

/** Apply the server's saved row before navigating back to an inactive cached list. */
export function updateMarketFeedCache(client: QueryClient, scope: FeedQueryScope, result: AdditionalFeedActionResponse) {
  if (!result.ok || !result.entry) return;
  const saved = result.entry;
  client.setQueriesData<AdditionalFeedsResponse>({ queryKey: [...feedKeys.all(scope), "additional"] }, (current) => {
    if (!current?.ok) return current;
    return { ...current, feeds: current.feeds.map(entry => entry.feed.id === saved.feed.id ? saved : entry) };
  });
}

export async function saveMarketConfiguration(
  input: {
    feedId: string;
    customConfigurationEnabled: boolean;
    expectedRevision: number;
    idCountryCode?: string;
    customConfiguration?: object;
  },
  toggleOnly = false,
) {
  const response = await fetch("/app/additional-feeds", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      intent: toggleOnly ? "toggle-configuration" : "save-configuration",
    }),
  });
  const result = (await response.json()) as AdditionalFeedActionResponse;
  if (!response.ok || !result.ok)
    throw new Error(
      !result.ok ? result.error : "The market settings could not be saved.",
    );
  return result;
}
