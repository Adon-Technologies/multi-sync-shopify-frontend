import { queryOptions } from "@tanstack/react-query";

import type { FeedDataResponse } from "../routes/app.feed-data";

export interface FeedQueryScope {
  locale: string | null;
  sessionId: string;
  shop: string;
}

export const feedKeys = {
  primary: (scope: FeedQueryScope, endpoint: string) =>
    [
      "feeds",
      scope.shop,
      scope.sessionId,
      "primary",
      endpoint,
    ] as const,
};

async function readResponse(response: Response) {
  const payload = (await response.json()) as FeedDataResponse;

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.ok ? "Feed data couldn't be loaded." : payload.error,
    );
  }

  return payload;
}

export function primaryFeedQueryOptions(
  scope: FeedQueryScope,
  endpoint = "/app/feed-data",
) {
  return queryOptions({
    queryKey: feedKeys.primary(scope, endpoint),
    queryFn: async ({ signal }) => {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal,
      });

      return readResponse(response);
    },
    gcTime: Infinity,
    retry: false,
    staleTime: Infinity,
  });
}

export async function generatePrimaryFeed(
  endpoint = "/app/feed-data",
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  return readResponse(response);
}
