import { createHmac } from "node:crypto";

import { upsertInstalledStore } from "./store.server";

const backendBaseUrl = (
  process.env.MULTI_SYNC_BACKEND_URL || "http://127.0.0.1:3000"
).replace(/\/+$/, "");

interface FeedSession {
  accessToken?: string;
  shop: string;
}

export class FeedBackendError extends Error {
  readonly status: number;

  constructor(
    message = "Feed data couldn't be loaded. Try again.",
    status = 502,
  ) {
    super(message);
    this.name = "FeedBackendError";
    this.status = status;
  }
}

function signature(
  accessToken: string,
  timestamp: string,
  method: string,
  requestTarget: string,
  body: string,
) {
  return createHmac("sha256", accessToken)
    .update(`${timestamp}.${method.toUpperCase()}.${requestTarget}.${body}`)
    .digest("hex");
}

export async function requestFeedBackend<TResponse>(
  session: FeedSession,
  method: "DELETE" | "GET" | "POST",
  pathname: string,
  input?: unknown,
) {
  const store = await upsertInstalledStore(session);

  if (!session.accessToken || !store.accessToken) {
    throw new FeedBackendError(
      "Shopify authentication needs to be renewed. Reopen the app and try again.",
      401,
    );
  }

  const timestamp = Date.now().toString();
  const body = input === undefined ? "" : JSON.stringify(input);
  const requestUrl = new URL(
    pathname,
    "http://multi-sync.internal",
  );
  requestUrl.searchParams.sort();
  const canonicalQuery = requestUrl.searchParams.toString();
  const canonicalTarget = `${requestUrl.pathname}${
    canonicalQuery ? `?${canonicalQuery}` : ""
  }`;
  let response: Response;

  try {
    response = await fetch(`${backendBaseUrl}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        "x-multi-sync-shop": store.shopDomain,
        "x-multi-sync-signature": signature(
          store.accessToken,
          timestamp,
          method,
          canonicalTarget,
          body,
        ),
        "x-multi-sync-timestamp": timestamp,
      },
      ...(body ? { body } : {}),
    });
  } catch {
    throw new FeedBackendError(
      "The feed service is unavailable. Make sure the backend is running and try again.",
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | (TResponse & { error?: string })
    | null;

  if (!response.ok || !payload) {
    throw new FeedBackendError(
      payload?.error || "The feed service couldn't complete the request.",
      response.status,
    );
  }

  return payload;
}
