import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  FeedBackendError,
  requestFeedBackend,
} from "../services/feed-backend.server";
import { getStoredPrimaryFeedMetadata } from "../services/feed-metadata.server";
import { authenticate } from "../shopify.server";

export type FeedStatus =
  | "NOT_GENERATED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface FeedMetadata {
  createdAt: string;
  fileSizeBytes: string | null;
  generatedItems: number;
  generationCompletedAt: string | null;
  generationStartedAt: string | null;
  gcsObjectName: string | null;
  id: string;
  lastError: string | null;
  lastRefreshedAt: string | null;
  processedProducts: number;
  processedVariants: number;
  publicUrl: string;
  skippedItems: number;
  status: FeedStatus;
  totalProducts: number | null;
  updatedAt: string;
}

export interface FeedMarket {
  countryCode: string | null;
  countryName: string | null;
  currencyCode: string;
  currencyName: string | null;
  id: string;
  locale: string;
  name: string;
}

export type FeedDataResponse =
  | {
      ok: true;
      feed: FeedMetadata | null;
      market: FeedMarket | null;
      backendUnavailable: boolean;
      marketUnavailable: boolean;
    }
  | {
      ok: false;
      error: string;
    };

function errorResponse(error: unknown) {
  const message =
    error instanceof FeedBackendError
      ? error.message
      : "Feed data couldn't be loaded. Try again.";
  const status = error instanceof FeedBackendError ? error.status : 500;

  return Response.json(
    { ok: false, error: message } satisfies FeedDataResponse,
    { status },
  );
}

function withBackendAvailability(result: FeedDataResponse) {
  return result.ok
    ? { ...result, backendUnavailable: false }
    : result;
}

function isBackendUnavailable(error: unknown) {
  return (
    error instanceof FeedBackendError &&
    [502, 503, 504].includes(error.status)
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const result = await requestFeedBackend<FeedDataResponse>(
      session,
      "GET",
      "/api/feeds/primary",
    );
    return Response.json(withBackendAvailability(result));
  } catch (error) {
    if (isBackendUnavailable(error)) {
      try {
        const stored = await getStoredPrimaryFeedMetadata(session);
        return Response.json({
          ok: true,
          ...stored,
          backendUnavailable: true,
          marketUnavailable: true,
        } satisfies FeedDataResponse);
      } catch {
        // Preserve the original backend error when the database fallback fails.
      }
    }

    return errorResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const result = await requestFeedBackend<FeedDataResponse>(
      session,
      "POST",
      "/api/feeds/primary/generate",
    );
    return Response.json(withBackendAvailability(result), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
};
