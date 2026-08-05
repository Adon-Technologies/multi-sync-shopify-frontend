import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";

import {
  FeedBackendError,
  requestFeedBackend,
} from "../services/feed-backend.server";
import { authenticateSubscribedAdmin } from "../shopify.server";
import type { ActiveFeedGeneration } from "./app.feed-data";

export type FeedRefreshAllResponse =
  | {
      activeGeneration: ActiveFeedGeneration;
      ok: true;
      runId: string;
      status: "QUEUED";
      totalFeeds: number;
    }
  | { error: string; ok: false };

export type FeedRefreshAllStatusResponse =
  | {
      completedFeeds: number;
      failedFeeds: number;
      ok: true;
      runError: string | null;
      runId: string;
      status:
        | "QUEUED"
        | "PROCESSING"
        | "SUCCESS"
        | "PARTIALLY_FAILED"
        | "FAILED";
      totalFeeds: number;
    }
  | { error: string; ok: false };

function errorResponse(error: unknown) {
  const message =
    error instanceof FeedBackendError
      ? error.message
      : "The XML refresh status couldn't be loaded. Try again.";
  const status = error instanceof FeedBackendError ? error.status : 500;

  return Response.json(
    { error: message, ok: false } satisfies FeedRefreshAllStatusResponse,
    { status },
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateSubscribedAdmin(request);
  const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";

  try {
    const result = await requestFeedBackend<FeedRefreshAllStatusResponse>(
      session,
      "GET",
      `/api/feeds/refresh-all/${encodeURIComponent(runId)}`,
    );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateSubscribedAdmin(request);

  try {
    const result = await requestFeedBackend<FeedRefreshAllResponse>(
      session,
      "POST",
      "/api/feeds/refresh-all",
    );
    return Response.json(result, { status: 202 });
  } catch (error) {
    const message =
      error instanceof FeedBackendError
        ? error.message
        : "The XML refresh couldn't be started. Try again.";
    const status = error instanceof FeedBackendError ? error.status : 500;

    return Response.json(
      { error: message, ok: false } satisfies FeedRefreshAllResponse,
      { status },
    );
  }
};
