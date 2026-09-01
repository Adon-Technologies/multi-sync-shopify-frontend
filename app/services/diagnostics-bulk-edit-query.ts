import { queryOptions } from "@tanstack/react-query";

import type {
  DiagnosticsBulkEditJob,
  DiagnosticsBulkEditRequest,
} from "./diagnostics-bulk-edit";
import type { DiagnosticsQueryScope } from "./diagnostics-query";

const defaultEndpoint = "/app/diagnostics-bulk-edit";

interface BulkEditResponse {
  error?: string;
  job?: DiagnosticsBulkEditJob | null;
  ok: boolean;
}

export const diagnosticsBulkEditKeys = {
  latest: ({ sessionId, shop }: DiagnosticsQueryScope) =>
    ["diagnostics-bulk-edit", shop, sessionId, "latest"] as const,
};

async function readResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as BulkEditResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.error ?? "The catalog bulk edit could not be loaded.",
    );
  }
  return payload.job ?? null;
}

export function diagnosticsBulkEditStatusQueryOptions(
  scope: DiagnosticsQueryScope,
  endpoint = defaultEndpoint,
) {
  return queryOptions({
    queryKey: diagnosticsBulkEditKeys.latest(scope),
    queryFn: async (): Promise<DiagnosticsBulkEditJob | null> =>
      readResponse(
        await fetch(endpoint, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        }),
      ),
    refetchOnMount: "always" as const,
    staleTime: 0,
  });
}

export async function requestDiagnosticsBulkEdit(
  request: DiagnosticsBulkEditRequest,
  endpoint = defaultEndpoint,
) {
  const job = await readResponse(
    await fetch(endpoint, {
      body: JSON.stringify(request),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  if (!job) {
    throw new Error("Shopify accepted no product type bulk-edit job.");
  }
  return job;
}
