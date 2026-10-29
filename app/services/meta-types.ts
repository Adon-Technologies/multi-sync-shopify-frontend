export interface MetaConnection {
  status: string;
  accountId: string | null;
  accountName: string | null;
  businessId: string | null;
  businessName: string | null;
  catalogId: string | null;
  catalogName: string | null;
  connectedAt: string | null;
  automaticSync?: boolean;
  access: {
    catalogMetadataRead: "VERIFIED" | "UNVERIFIED";
    productWrite: "UNVERIFIED" | "VERIFIED";
  };
}
export interface MetaStatus {
  ok: boolean;
  connection: MetaConnection | null;
  setup: {
    id: string;
    accountName: string | null;
    businessId: string | null;
    catalogId: string | null;
  } | null;
  error: string | null;
  code: string | null;
  oauthError: string | null;
}
export interface MetaOption {
  id: string;
  name: string;
}

export async function metaRequest<T>(
  input?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/app/meta-data", {
      method: input ? "POST" : "GET",
      signal,
      headers: {
        Accept: "application/json",
        ...(input ? { "Content-Type": "application/json" } : {}),
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  } catch {
    throw new Error(
      "The Facebook connection service is unavailable. Try again.",
    );
  }
  const payload = await response.json().catch(() => null);
  if (
    payload?.cloudflare_error === true ||
    (!response.ok &&
      !payload?.error &&
      [502, 503, 504].includes(response.status))
  )
    throw new Error(
      "The app's development tunnel or server is unavailable. Check that Shopify app dev and the backend are running, reopen the current development preview, then refresh the connection status before trying again.",
    );
  if (!response.ok || !payload?.ok)
    throw new Error(
      (typeof payload?.error === "string" ? payload.error : undefined) ||
        "The Facebook connection could not be completed. Reopen the app and try again.",
    );
  return payload as T;
}

export function oauthErrorMessage(code: string) {
  if (code === "OAUTH_CANCELLED")
    return "Facebook login was cancelled or permission was declined. Your existing connection has been kept.";
  if (code === "MISSING_PERMISSIONS")
    return "Facebook did not grant the required business and catalog permissions. Connect again and grant both permissions.";
  return "Facebook authentication could not be completed. Connect with Facebook again. Your existing connection has been kept.";
}
