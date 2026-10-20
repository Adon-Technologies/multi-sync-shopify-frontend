import { createHash } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticateActiveAdmin } from "../shopify.server";
import { hasTrustedMetaOrigin } from "../services/meta-request.server";
import {
  FeedBackendError,
  requestFeedBackend,
} from "../services/feed-backend.server";

const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  const status =
    error instanceof FeedBackendError &&
    error.status >= 400 &&
    error.status <= 599
      ? error.status
      : 503;
  return Response.json(
    {
      ok: false,
      error:
        error instanceof FeedBackendError
          ? error.message
          : "The Facebook connection service is unavailable. Try again.",
    },
    { status, headers },
  );
}
async function context(request: Request) {
  const auth = await authenticateActiveAdmin(request);
  if (!auth.sessionToken?.sub)
    throw new Response("Shopify authentication is required.", { status: 401 });
  return {
    session: auth.session,
    actorId: createHash("sha256")
      .update(`${auth.session.shop}:${auth.sessionToken.sub}`)
      .digest("hex"),
  };
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const signal = AbortSignal.timeout(60_000);
  try {
    const { session, actorId } = await context(request);
    return Response.json(
      await requestFeedBackend(
        session,
        "GET",
        `/api/integrations/meta?actorId=${actorId}`,
        undefined,
        { readOnlyStore: true, signal },
      ),
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    if (signal.aborted) return timeoutFailure();
    return failure(error);
  }
};
export const action = async ({ request }: ActionFunctionArgs) => {
  const signal = AbortSignal.timeout(60_000);
  try {
    const { session, actorId } = await context(request);
    if (request.method !== "POST")
      return Response.json(
        {
          ok: false,
          code: "INVALID_METHOD",
          error: "Use POST for this connection request.",
        },
        { status: 405, headers },
      );
    if (!hasTrustedMetaOrigin(request)) {
      return Response.json(
        {
          ok: false,
          code: "INVALID_REQUEST_ORIGIN",
          error:
            "The connection request came from an unexpected app address. Reopen Multi Sync from your Shopify development preview and try again.",
        },
        { status: 403, headers },
      );
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      return Response.json(
        {
          ok: false,
          code: "INVALID_REQUEST_FORMAT",
          error:
            "The connection request format is invalid. Refresh Multi Sync and try again.",
        },
        { status: 403, headers },
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json(
        {
          ok: false,
          code: "INVALID_REQUEST",
          error:
            "The connection request is invalid. Refresh Multi Sync and try again.",
        },
        { status: 400, headers },
      );
    const values = body as Record<string, unknown>;
    // Explicit allowlist excludes caller-supplied store and actor identities.
    const input = {
      actorId,
      intent: values.intent,
      attemptId: values.attemptId,
      businessId: values.businessId,
      catalogId: values.catalogId,
      mode: values.mode,
      confirmed: values.confirmed === true,
      productIds: values.productIds,
    };
    return Response.json(
      await requestFeedBackend(
        session,
        "POST",
        "/api/integrations/meta",
        input,
        { readOnlyStore: true, signal },
      ),
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    if (signal.aborted) return timeoutFailure();
    return failure(error);
  }
};

function timeoutFailure() {
  return Response.json(
    {
      ok: false,
      code: "META_BACKEND_TIMEOUT",
      error:
        "The connection service took too long to respond. Refresh the connection status before trying again.",
    },
    { status: 504, headers },
  );
}
