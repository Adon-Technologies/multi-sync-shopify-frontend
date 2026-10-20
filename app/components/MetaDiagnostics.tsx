import { useQuery } from "@tanstack/react-query";
import { metaRequest } from "../services/meta-types";
import type { DiagnosticsQueryScope } from "../services/diagnostics-query";

export interface FacebookDiagnostic {
  status: string;
  counts: Partial<Record<string, number>>;
  messages?: string[];
}
export function useMetaDiagnostics(
  scope: DiagnosticsQueryScope | null,
  productIds: string[],
) {
  return useQuery({
    queryKey: [
      "meta-diagnostics",
      scope?.shop,
      scope?.sessionId,
      ...productIds,
    ],
    queryFn: ({ signal }) =>
      metaRequest<{
        active: boolean;
        products: Record<string, FacebookDiagnostic>;
      }>({ intent: "diagnostics", productIds }, signal),
    enabled: Boolean(scope && productIds.length),
    retry: false,
    staleTime: 5000,
    refetchInterval: (q) => (q.state.data?.active ? 5000 : 30_000),
  });
}
export function FacebookStatus({
  value,
  failed,
}: {
  value?: FacebookDiagnostic;
  failed: boolean;
}) {
  const status = failed ? "Status unavailable" : (value?.status ?? "Loading");
  const counts = failed ? {} : (value?.counts ?? {});
  const detail = Object.entries(counts)
    .map(([state, n]) => `${state.toLowerCase()}: ${n}`)
    .join(", ");
  return (
    <div title={detail || status}>
      <s-badge
        tone={
          status === "Submitted"
            ? "success"
            : status === "Error"
              ? "critical"
              : ["Submitted with warnings", "Needs attention"].includes(status)
                ? "warning"
                : "neutral"
        }
      >
        {status}
      </s-badge>
      {Object.keys(counts).length > 1 ? (
        <small style={{ display: "block" }}>{detail}</small>
      ) : null}
      {!failed && value?.messages?.length ? (
        <details>
          <summary>Details</summary>
          {value.messages.map((message) => (
            <small key={message} style={{ display: "block" }}>
              {message}
            </small>
          ))}
        </details>
      ) : null}
    </div>
  );
}
