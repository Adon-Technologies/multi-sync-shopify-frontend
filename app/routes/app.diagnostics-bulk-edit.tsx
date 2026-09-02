import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import type { DiagnosticsBulkEditRequest } from "../services/diagnostics-bulk-edit";
import {
  createDiagnosticsBulkEditJob,
  DiagnosticsBulkEditRequestError,
  getLatestDiagnosticsBulkEditJob,
} from "../services/diagnostics-bulk-edit.server";
import { authenticateSubscribedAdmin } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateSubscribedAdmin(request);
  return Response.json({
    job: await getLatestDiagnosticsBulkEditJob(session.shop),
    ok: true,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticateSubscribedAdmin(request);

  try {
    const payload = (await request.json()) as DiagnosticsBulkEditRequest;
    const job = await createDiagnosticsBulkEditJob(
      admin,
      session.shop,
      payload,
    );
    return Response.json({ job, ok: true }, { status: 202 });
  } catch (error) {
    const requestError =
      error instanceof DiagnosticsBulkEditRequestError ? error : null;
    if (!requestError) {
      console.error("Diagnostics bulk edit request failed", error);
    }
    return Response.json(
      {
        error:
          requestError?.message ??
          "The catalog bulk edit could not be started. Try again.",
        ok: false,
      },
      { status: requestError?.status ?? 500 },
    );
  }
};
