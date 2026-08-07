import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const APP_HANDLE = "multi-sync-google-feed";
export const DATABASE_NAME = "Multi-sync";
export const SHOP_PATTERN =
  /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShop(value) {
  const shop =
    typeof value === "string"
      ? value.normalize("NFKC").trim().toLowerCase()
      : "";
  return SHOP_PATTERN.test(shop) ? shop : null;
}

export function fingerprint(value) {
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 16)
    : null;
}

export function approvalHash(candidate) {
  const { approvalHash: _approvalHash, ...unsigned } = candidate;
  return createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function readEnvironment(path) {
  const values = {};
  const content = await readFile(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = unquote(
      line.slice(separator + 1),
    );
  }
  return values;
}

export function databaseName(connectionString) {
  if (!connectionString) return null;
  const withoutQuery = connectionString.split("?", 1)[0];
  const slash = withoutQuery.lastIndexOf("/");
  return slash >= 0
    ? decodeURIComponent(withoutQuery.slice(slash + 1))
    : null;
}

export async function readCutoverClientId(path) {
  const content = await readFile(path, "utf8");
  return (
    content.match(
      /^\s*client_id\s*=\s*["']([^"']+)["']\s*$/m,
    )?.[1]?.trim() ?? null
  );
}

function wait(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

export async function validateAdminToken(
  shopDomain,
  accessToken,
  apiVersion = "2026-07",
) {
  const query = `#graphql
    query TokenExchangeReadiness {
      shop {
        myshopifyDomain
      }
    }
  `;
  const endpoint = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await wait(
          Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.min(retryAfter * 1_000, 10_000)
            : 500 * 2 ** attempt,
        );
        continue;
      }
      const returnedShop = normalizeShop(
        payload?.data?.shop?.myshopifyDomain,
      );
      return {
        httpStatus: response.status,
        ok:
          response.ok &&
          !payload?.errors?.length &&
          returnedShop === shopDomain,
      };
    } catch (error) {
      if (attempt === 2) {
        return {
          error: error instanceof Error ? error.name : "UNKNOWN",
          httpStatus: null,
          ok: false,
        };
      }
      await wait(500 * 2 ** attempt);
    }
  }
}

function positiveSeconds(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
    ? Math.floor(value)
    : null;
}

export function parseTokenExchangeResponse(payload, now = new Date()) {
  const accessToken =
    typeof payload?.access_token === "string"
      ? payload.access_token.trim()
      : "";
  const refreshToken =
    typeof payload?.refresh_token === "string"
      ? payload.refresh_token.trim()
      : "";
  const expiresIn = positiveSeconds(payload?.expires_in);
  const refreshTokenExpiresIn = positiveSeconds(
    payload?.refresh_token_expires_in,
  );
  if (
    !accessToken ||
    !refreshToken ||
    !expiresIn ||
    !refreshTokenExpiresIn
  ) {
    throw new Error(
      "Shopify returned an incomplete expiring offline-token response.",
    );
  }
  return {
    accessToken,
    accessTokenExpiresAt: new Date(now.getTime() + expiresIn * 1_000),
    refreshToken,
    refreshTokenExpiresAt: new Date(
      now.getTime() + refreshTokenExpiresIn * 1_000,
    ),
  };
}
