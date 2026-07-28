import {
  infiniteQueryOptions,
  queryOptions,
} from "@tanstack/react-query";

import type {
  AutomaticRefreshStatus,
  FeedRefreshSchedule,
  FeedRefreshScheduleResponse,
  FeedRefreshTimezonesResponse,
  SaveFeedRefreshScheduleInput,
} from "../routes/app.feed-refresh-schedule";
import type { FeedQueryScope } from "./feed-query";

const defaultEndpoint = "/app/feed-refresh-schedule";

export type FeedRefreshScheduleDraft = SaveFeedRefreshScheduleInput;

export interface FeedRefreshTimezonePage {
  nextCursor: string | null;
  timezones: string[];
}

export const DEFAULT_FEED_REFRESH_SCHEDULE: FeedRefreshScheduleDraft = {
  customAutomaticRefresh: false,
  customTime: null,
  customTimezone: null,
};

export const feedRefreshKeys = {
  all: ({ shop, sessionId }: FeedQueryScope) =>
    ["feed-refresh-schedule", shop, sessionId] as const,
  schedule: (scope: FeedQueryScope, endpoint = defaultEndpoint) =>
    [...feedRefreshKeys.all(scope), "schedule", endpoint] as const,
  timezones: (
    scope: FeedQueryScope,
    search: string,
    endpoint = defaultEndpoint,
  ) =>
    [
      ...feedRefreshKeys.all(scope),
      "timezones",
      normalizeTimezoneSearch(search).toLocaleLowerCase(),
      endpoint,
    ] as const,
};

interface ErrorResponse {
  error?: string;
  ok: false;
}

async function readResponse<TValue extends { ok: true }>(response: Response) {
  const payload = (await response.json()) as TValue | ErrorResponse;

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload.ok === false && payload.error
        ? payload.error
        : "The automatic refresh request couldn't be completed.",
    );
  }

  return payload as TValue;
}

export function normalizeTimezoneSearch(value: string) {
  return value.normalize("NFKC").trim().slice(0, 100);
}

export function isAutomaticRefreshActive(
  status: AutomaticRefreshStatus | null | undefined,
) {
  return status === "QUEUED" || status === "PROCESSING";
}

export function scheduleDraftFrom(
  schedule: Pick<
    FeedRefreshSchedule,
    "customAutomaticRefresh" | "customTime" | "customTimezone"
  >,
): FeedRefreshScheduleDraft {
  return {
    customAutomaticRefresh: schedule.customAutomaticRefresh,
    customTime: schedule.customAutomaticRefresh
      ? schedule.customTime ?? "00:00"
      : null,
    customTimezone: schedule.customAutomaticRefresh
      ? schedule.customTimezone ?? "UTC"
      : null,
  };
}

export function feedRefreshDraftFingerprint(
  value: FeedRefreshScheduleDraft,
) {
  return JSON.stringify([
    value.customAutomaticRefresh,
    value.customTime,
    value.customTimezone,
  ]);
}

export function parseTime24(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

export function time24From12(
  hour: number,
  minute: number,
  period: "AM" | "PM",
) {
  if (
    !Number.isInteger(hour) ||
    hour < 1 ||
    hour > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const normalizedHour =
    period === "AM" ? hour % 12 : (hour % 12) + 12;
  return `${normalizedHour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}

export function formatTime12(value: string) {
  const parsed = parseTime24(value);
  if (!parsed) return "Invalid time";

  const period = parsed.hour >= 12 ? "PM" : "AM";
  const hour = parsed.hour % 12 || 12;
  return `${hour}:${parsed.minute.toString().padStart(2, "0")} ${period}`;
}

export function feedRefreshScheduleQueryOptions(
  scope: FeedQueryScope,
  endpoint = defaultEndpoint,
) {
  return queryOptions({
    queryKey: feedRefreshKeys.schedule(scope, endpoint),
    queryFn: async ({ signal }) => {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await readResponse<FeedRefreshScheduleResponse & {
        ok: true;
      }>(response);
      return payload.schedule;
    },
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
}

export function feedRefreshTimezonesInfiniteQueryOptions(
  scope: FeedQueryScope,
  search: string,
  endpoint = defaultEndpoint,
) {
  const normalized = normalizeTimezoneSearch(search);

  return infiniteQueryOptions({
    getNextPageParam: (lastPage: FeedRefreshTimezonePage) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryKey: feedRefreshKeys.timezones(scope, normalized, endpoint),
    queryFn: async ({
      pageParam,
      signal,
    }): Promise<FeedRefreshTimezonePage> => {
      const params = new URLSearchParams({
        cursor: pageParam ?? "0",
        resource: "timezones",
        search: normalized,
      });
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await readResponse<FeedRefreshTimezonesResponse & {
        ok: true;
      }>(response);
      return {
        nextCursor: payload.nextCursor,
        timezones: payload.timezones,
      };
    },
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
}

export async function saveFeedRefreshSchedule(
  value: FeedRefreshScheduleDraft,
  endpoint = defaultEndpoint,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });

  const payload = await readResponse<FeedRefreshScheduleResponse & {
    ok: true;
  }>(response);
  return payload.schedule;
}
