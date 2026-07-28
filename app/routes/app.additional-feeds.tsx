import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  FeedBackendError,
  requestFeedBackend,
} from "../services/feed-backend.server";
import { getStoredAdditionalFeedMetadata } from "../services/feed-metadata.server";
import { authenticate } from "../shopify.server";
import type {
  ActiveFeedGeneration,
  FeedMarket,
  FeedMetadata,
} from "./app.feed-data";

export interface AdditionalFeedEntry {
  feed: FeedMetadata;
  market: FeedMarket;
}

export interface AdditionalMarketOption {
  availableLanguageCount: number;
  countryCode: string;
  countryName: string;
  currencyCode: string;
  marketId: string;
  marketName: string;
  value: string;
}

export interface AdditionalLanguageOption {
  locale: string;
  name: string;
}

export type AdditionalFeedsResponse =
  | {
      activeGeneration: ActiveFeedGeneration | null;
      backendUnavailable: boolean;
      feeds: AdditionalFeedEntry[];
      ok: true;
    }
  | { error: string; ok: false };

export type AdditionalMarketOptionsResponse =
  | { ok: true; options: AdditionalMarketOption[] }
  | { error: string; ok: false };

export type AdditionalLanguagesResponse =
  | { languages: AdditionalLanguageOption[]; ok: true }
  | { error: string; ok: false };

export type AdditionalFeedActionResponse =
  | {
      activeGeneration?: ActiveFeedGeneration | null;
      deletedFeedId?: string;
      entry?: AdditionalFeedEntry;
      ok: true;
    }
  | { error: string; ok: false };

function errorResponse(error: unknown) {
  const message =
    error instanceof FeedBackendError
      ? error.message
      : "The additional feed request couldn't be completed. Try again.";
  const status = error instanceof FeedBackendError ? error.status : 500;

  return Response.json({ ok: false, error: message }, { status });
}

function isBackendUnavailable(error: unknown) {
  return (
    error instanceof FeedBackendError &&
    [502, 503, 504].includes(error.status)
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "feeds";

  try {
    if (resource === "markets") {
      const result =
        await requestFeedBackend<AdditionalMarketOptionsResponse>(
          session,
          "GET",
          "/api/feeds/additional/options",
        );
      return Response.json(result);
    }

    if (resource === "languages") {
      const marketId = url.searchParams.get("marketId") ?? "";
      const countryCode = url.searchParams.get("countryCode") ?? "";
      const result = await requestFeedBackend<AdditionalLanguagesResponse>(
        session,
        "POST",
        "/api/feeds/additional/languages",
        { countryCode, marketId },
      );
      return Response.json(result);
    }

    const result = await requestFeedBackend<AdditionalFeedsResponse>(
      session,
      "GET",
      "/api/feeds/additional",
    );
    return Response.json(
      result.ok ? { ...result, backendUnavailable: false } : result,
    );
  } catch (error) {
    if (resource === "feeds" && isBackendUnavailable(error)) {
      try {
        const stored = await getStoredAdditionalFeedMetadata(session);
        return Response.json({
          ok: true,
          ...stored,
          backendUnavailable: true,
        } satisfies AdditionalFeedsResponse);
      } catch {
        // Preserve the backend failure if the database fallback also fails.
      }
    }
    return errorResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const input = (await request.json().catch(() => null)) as
    | {
        countryCode?: unknown;
        feedId?: unknown;
        intent?: unknown;
        locale?: unknown;
        marketId?: unknown;
      }
    | null;
  const intent = typeof input?.intent === "string" ? input.intent : "";

  try {
    if (intent === "generate") {
      const result = await requestFeedBackend<AdditionalFeedActionResponse>(
        session,
        "POST",
        "/api/feeds/additional/generate",
        {
          countryCode:
            typeof input?.countryCode === "string"
              ? input.countryCode
              : "",
          locale:
            typeof input?.locale === "string" ? input.locale : "",
          marketId:
            typeof input?.marketId === "string" ? input.marketId : "",
        },
      );
      return Response.json(result, { status: 202 });
    }

    const feedId =
      typeof input?.feedId === "string" ? input.feedId.trim() : "";
    if (!feedId) {
      return Response.json(
        { ok: false, error: "The feed could not be identified." },
        { status: 400 },
      );
    }

    if (intent === "refresh") {
      const result = await requestFeedBackend<AdditionalFeedActionResponse>(
        session,
        "POST",
        `/api/feeds/additional/${encodeURIComponent(feedId)}/refresh`,
      );
      return Response.json(result, { status: 202 });
    }

    if (intent === "delete") {
      const result = await requestFeedBackend<AdditionalFeedActionResponse>(
        session,
        "DELETE",
        `/api/feeds/additional/${encodeURIComponent(feedId)}`,
      );
      return Response.json(result);
    }

    return Response.json(
      { ok: false, error: "Unsupported additional feed action." },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
};
