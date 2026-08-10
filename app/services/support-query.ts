import { queryOptions } from "@tanstack/react-query";

import type {
  SupportActionResponse,
  SupportTicketDetailResponse,
  SupportTicketListResponse,
} from "../routes/app.support-data";

export interface SupportQueryScope {
  sessionId: string;
  shop: string;
}

export const supportKeys = {
  all: (scope: SupportQueryScope) =>
    ["support", scope.shop, scope.sessionId] as const,
  detail: (scope: SupportQueryScope, ticketId: string) =>
    [...supportKeys.all(scope), "detail", ticketId] as const,
  list: (scope: SupportQueryScope, page: number) =>
    [...supportKeys.all(scope), "list", page] as const,
};

async function readResponse<TPayload extends { error?: string; ok: boolean }>(
  response: Response,
) {
  const payload = (await response.json()) as TPayload;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Support is temporarily unavailable.");
  }
  return payload;
}

export function supportTicketListQueryOptions(
  scope: SupportQueryScope,
  page: number,
  endpoint = "/app/support-data",
) {
  return queryOptions({
    queryKey: supportKeys.list(scope, page),
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({ page: String(page), pageSize: "25" });
      const response = await fetch(`${endpoint}?${search.toString()}`, {
        headers: { Accept: "application/json" },
        signal,
      });
      return readResponse<SupportTicketListResponse>(response);
    },
    staleTime: 0,
  });
}

export async function fetchSupportTicketPage(
  ticketId: string,
  before?: string,
  endpoint = "/app/support-data",
) {
  const search = new URLSearchParams({ ticketId });
  if (before) search.set("before", before);
  const response = await fetch(`${endpoint}?${search.toString()}`, {
    headers: { Accept: "application/json" },
  });
  return readResponse<SupportTicketDetailResponse>(response);
}

export function supportTicketDetailQueryOptions(
  scope: SupportQueryScope,
  ticketId: string,
) {
  return queryOptions({
    queryKey: supportKeys.detail(scope, ticketId),
    queryFn: () => fetchSupportTicketPage(ticketId),
    staleTime: 0,
  });
}

async function supportMutation(
  input:
    | { intent: "create"; title: string }
    | { intent: "message"; message: string; ticketId: string }
    | { intent: "close"; ticketId: string },
  endpoint = "/app/support-data",
) {
  const response = await fetch(endpoint, {
    body: JSON.stringify(input),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST",
  });
  return readResponse<SupportActionResponse>(response);
}

export function createSupportTicket(title: string) {
  return supportMutation({ intent: "create", title });
}

export function sendSupportMessage(ticketId: string, message: string) {
  return supportMutation({ intent: "message", message, ticketId });
}

export function closeSupportTicket(ticketId: string) {
  return supportMutation({ intent: "close", ticketId });
}
