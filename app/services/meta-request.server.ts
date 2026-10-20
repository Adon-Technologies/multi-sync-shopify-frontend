/** Public origins are server configuration, never taken from forwarding headers.
 * Shopify CLI can forward an HTTPS preview request to an internal HTTP URL.
 * Authentication is still required before this additional CSRF check is used.
 */
export function hasTrustedMetaOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const trustedOrigins = new Set([new URL(request.url).origin]);
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (appUrl) {
    try {
      const configured = new URL(appUrl);
      if (
        ["https:", "http:"].includes(configured.protocol) &&
        !configured.username &&
        !configured.password
      ) {
        trustedOrigins.add(configured.origin);
      }
    } catch {
      // An invalid app URL cannot add an origin to the allowlist.
    }
  }
  return trustedOrigins.has(origin);
}
