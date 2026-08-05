import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  getSubscriptionForSession,
} from "../services/subscription.server";
import { authenticateActiveAdmin } from "../shopify.server";

function errorResponse(error: unknown) {
  const safeMessage =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "Your subscription could not be verified. Try again.";
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 503;
  return Response.json(
    { error: safeMessage, ok: false },
    { status },
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateActiveAdmin(request);
  try {
    return Response.json({
      ok: true,
      subscription: await getSubscriptionForSession(session),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateActiveAdmin(request);
  try {
    return Response.json({
      ok: true,
      subscription: await getSubscriptionForSession(session, {
        force: true,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
};
