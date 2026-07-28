import { queryOptions } from "@tanstack/react-query";

import type {
  AdditionalFeedActionResponse,
  AdditionalFeedsResponse,
  AdditionalLanguagesResponse,
  AdditionalMarketOptionsResponse,
} from "../routes/app.additional-feeds";
import type { FeedDataResponse } from "../routes/app.feed-data";

export interface FeedQueryScope {
  locale: string | null;
  sessionId: string;
  shop: string;
}

export const feedKeys = {
  all: (scope: FeedQueryScope) =>
    ["feeds", scope.shop, scope.sessionId] as const,
  additional: (scope: FeedQueryScope, endpoint: string) =>
    [...feedKeys.all(scope), "additional", endpoint] as const,
  languages: (
    scope: FeedQueryScope,
    endpoint: string,
    marketId: string,
    countryCode: string,
  ) =>
    [
      ...feedKeys.all(scope),
      "languages",
      endpoint,
      marketId,
      countryCode,
    ] as const,
  markets: (scope: FeedQueryScope, endpoint: string) =>
    [...feedKeys.all(scope), "markets", endpoint] as const,
  primary: (scope: FeedQueryScope, endpoint: string) =>
    [
      ...feedKeys.all(scope),
      "primary",
      endpoint,
    ] as const,
};

async function readResponse<TPayload extends { error?: string; ok: boolean }>(
  response: Response,
) {
  const payload = (await response.json()) as TPayload;

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.ok
        ? "Feed data couldn't be loaded."
        : payload.error || "Feed data couldn't be loaded.",
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

      return readResponse<FeedDataResponse>(response);
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

  return readResponse<FeedDataResponse>(response);
}

function resourceUrl(
  endpoint: string,
  resource: "feeds" | "languages" | "markets",
  params: Record<string, string> = {},
) {
  const search = new URLSearchParams({ resource, ...params });
  return `${endpoint}?${search.toString()}`;
}

export function additionalFeedsQueryOptions(
  scope: FeedQueryScope,
  endpoint = "/app/additional-feeds",
) {
  return queryOptions({
    queryKey: feedKeys.additional(scope, endpoint),
    queryFn: async ({ signal }) => {
      const response = await fetch(resourceUrl(endpoint, "feeds"), {
        headers: { Accept: "application/json" },
        signal,
      });
      return readResponse<AdditionalFeedsResponse>(response);
    },
    gcTime: Infinity,
    retry: false,
    staleTime: Infinity,
  });
}

export function additionalMarketOptionsQueryOptions(
  scope: FeedQueryScope,
  endpoint = "/app/additional-feeds",
) {
  return queryOptions({
    queryKey: feedKeys.markets(scope, endpoint),
    queryFn: async ({ signal }) => {
      const response = await fetch(resourceUrl(endpoint, "markets"), {
        headers: { Accept: "application/json" },
        signal,
      });
      return readResponse<AdditionalMarketOptionsResponse>(response);
    },
    gcTime: 5 * 60 * 1_000,
    retry: false,
    staleTime: 5 * 60 * 1_000,
  });
}

export function additionalLanguagesQueryOptions(
  scope: FeedQueryScope,
  marketId: string,
  countryCode: string,
  endpoint = "/app/additional-feeds",
) {
  return queryOptions({
    queryKey: feedKeys.languages(
      scope,
      endpoint,
      marketId,
      countryCode,
    ),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        resourceUrl(endpoint, "languages", { countryCode, marketId }),
        {
          headers: { Accept: "application/json" },
          signal,
        },
      );
      return readResponse<AdditionalLanguagesResponse>(response);
    },
    gcTime: 5 * 60 * 1_000,
    retry: false,
    staleTime: 5 * 60 * 1_000,
  });
}

async function mutateAdditionalFeed(
  input:
    | {
        countryCode: string;
        intent: "generate";
        locale: string;
        marketId: string;
      }
    | { feedId: string; intent: "delete" | "refresh" },
  endpoint = "/app/additional-feeds",
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  return readResponse<AdditionalFeedActionResponse>(response);
}

export function generateAdditionalFeed(
  input: {
    countryCode: string;
    locale: string;
    marketId: string;
  },
  endpoint?: string,
) {
  return mutateAdditionalFeed(
    { ...input, intent: "generate" },
    endpoint,
  );
}

export function refreshAdditionalFeed(
  feedId: string,
  endpoint?: string,
) {
  return mutateAdditionalFeed({ feedId, intent: "refresh" }, endpoint);
}

export function deleteAdditionalFeed(
  feedId: string,
  endpoint?: string,
) {
  return mutateAdditionalFeed({ feedId, intent: "delete" }, endpoint);
}
