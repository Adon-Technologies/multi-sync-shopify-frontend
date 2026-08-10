import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  FeedBackendError,
  requestFeedBackend,
} from "../services/feed-backend.server";
import { authenticateActiveAdmin } from "../shopify.server";

export type SupportTicketStatus = "PENDING" | "OPEN" | "CLOSED";
export type SupportSenderRole = "MERCHANT" | "SUPPORT";

export interface SupportTicketSummary {
  createdAt: string;
  id: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  merchantUnreadCount: number;
  messageCount: number;
  status: SupportTicketStatus;
  supportUnreadCount: number;
  title: string;
  updatedAt: string;
}

export interface SupportMessage {
  createdAt: string;
  id: string;
  message: string;
  senderId: string | null;
  senderName: string | null;
  senderRole: SupportSenderRole;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  closedAt: string | null;
  closedById: string | null;
  closedByRole: SupportSenderRole | null;
  firstSupportReplyAt: string | null;
  store: { shopDomain: string };
  storeId: string;
}

export interface SupportTicketListResponse {
  ok: true;
  pagination: {
    page: number;
    pageCount: number;
    pageSize: number;
    total: number;
  };
  tickets: SupportTicketSummary[];
}

export interface SupportTicketDetailResponse {
  hasMore: boolean;
  messages: SupportMessage[];
  nextBefore: string | null;
  ok: true;
  ticket: SupportTicketDetail;
}

export interface SupportActionResponse {
  message?: SupportMessage;
  ok: true;
  ticket: SupportTicketSummary;
}

function errorResponse(error: unknown) {
  const message =
    error instanceof FeedBackendError
      ? error.message
      : "Support is temporarily unavailable. Try again.";
  return Response.json(
    { error: message, ok: false },
    { status: error instanceof FeedBackendError ? error.status : 500 },
  );
}

function supportPath(request: Request) {
  const url = new URL(request.url);
  const ticketId = url.searchParams.get("ticketId");
  if (!ticketId) {
    const params = new URLSearchParams();
    for (const key of ["page", "pageSize", "status"]) {
      const value = url.searchParams.get(key);
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return `/api/support/tickets${query ? `?${query}` : ""}`;
  }
  const params = new URLSearchParams();
  const before = url.searchParams.get("before");
  if (before) params.set("before", before);
  const query = params.toString();
  return `/api/support/tickets/${encodeURIComponent(ticketId)}${query ? `?${query}` : ""}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateActiveAdmin(request);
  try {
    const result = await requestFeedBackend<
      SupportTicketListResponse | SupportTicketDetailResponse
    >(session, "GET", supportPath(request));
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateActiveAdmin(request);
  try {
    const body = (await request.json()) as {
      intent?: string;
      message?: unknown;
      ticketId?: unknown;
      title?: unknown;
    };
    let pathname = "/api/support/tickets";
    let input: unknown;
    if (body.intent === "create") {
      input = { title: body.title };
    } else if (
      (body.intent === "message" || body.intent === "close") &&
      typeof body.ticketId === "string"
    ) {
      pathname = `/api/support/tickets/${encodeURIComponent(body.ticketId)}/${
        body.intent === "message" ? "messages" : "close"
      }`;
      input = body.intent === "message" ? { message: body.message } : undefined;
    } else {
      return Response.json(
        { error: "The support action is invalid.", ok: false },
        { status: 400 },
      );
    }
    const result = await requestFeedBackend<SupportActionResponse>(
      session,
      "POST",
      pathname,
      input,
    );
    return Response.json(result, { status: body.intent === "close" ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
};
