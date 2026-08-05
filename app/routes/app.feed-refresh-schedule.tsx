import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  FeedBackendError,
  requestFeedBackend,
} from "../services/feed-backend.server";
import { authenticateSubscribedAdmin } from "../shopify.server";

export type AutomaticRefreshStatus =
  | "NEVER_RUN"
  | "QUEUED"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED";

export interface FeedRefreshSchedule {
  customAutomaticRefresh: boolean;
  customTime: string | null;
  customTimezone: string | null;
  effectiveTime: string;
  effectiveTimezone: string;
  lastAutomaticError: string | null;
  lastAutomaticFinishedAt: string | null;
  lastAutomaticStartedAt: string | null;
  lastAutomaticStatus: AutomaticRefreshStatus;
  nextRunAt: string;
  scheduleVersion: number;
  updatedAt: string;
}

export type FeedRefreshScheduleResponse =
  | {
      ok: true;
      schedule: FeedRefreshSchedule;
    }
  | {
      error: string;
      ok: false;
    };

export type FeedRefreshTimezonesResponse =
  | {
      nextCursor: string | null;
      ok: true;
      timezones: string[];
    }
  | {
      error: string;
      ok: false;
    };

export interface SaveFeedRefreshScheduleInput {
  customAutomaticRefresh: boolean;
  customTime: string | null;
  customTimezone: string | null;
}

function errorResponse(error: unknown) {
  const message =
    error instanceof FeedBackendError
      ? error.message
      : "The automatic refresh schedule couldn't be loaded. Try again.";
  const status = error instanceof FeedBackendError ? error.status : 500;

  return Response.json({ ok: false, error: message }, { status });
}

function normalizedSearch(value: string | null) {
  return (value ?? "").normalize("NFKC").trim().slice(0, 100);
}

function normalizedCursor(value: string | null) {
  const normalized = value?.trim() ?? "";
  return /^\d{1,8}$/.test(normalized) ? normalized : "0";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateSubscribedAdmin(request);
  const url = new URL(request.url);

  try {
    if (url.searchParams.get("resource") === "timezones") {
      const params = new URLSearchParams({
        cursor: normalizedCursor(url.searchParams.get("cursor")),
        limit: "100",
        search: normalizedSearch(url.searchParams.get("search")),
      });
      const result =
        await requestFeedBackend<FeedRefreshTimezonesResponse>(
          session,
          "GET",
          `/api/feed-refresh-timezones?${params.toString()}`,
        );
      return Response.json(result);
    }

    const result =
      await requestFeedBackend<FeedRefreshScheduleResponse>(
        session,
        "GET",
        "/api/feed-refresh-schedule",
      );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateSubscribedAdmin(request);
  const input = (await request.json().catch(() => null)) as
    | {
        customAutomaticRefresh?: unknown;
        customTime?: unknown;
        customTimezone?: unknown;
      }
    | null;

  if (typeof input?.customAutomaticRefresh !== "boolean") {
    return Response.json(
      {
        ok: false,
        error: "Choose a valid automatic refresh schedule.",
      },
      { status: 400 },
    );
  }

  const value: SaveFeedRefreshScheduleInput = {
    customAutomaticRefresh: input.customAutomaticRefresh,
    customTime:
      typeof input.customTime === "string"
        ? input.customTime.normalize("NFKC").trim()
        : null,
    customTimezone:
      typeof input.customTimezone === "string"
        ? input.customTimezone.normalize("NFKC").trim()
        : null,
  };

  try {
    const result =
      await requestFeedBackend<FeedRefreshScheduleResponse>(
        session,
        "POST",
        "/api/feed-refresh-schedule",
        value,
      );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
};
