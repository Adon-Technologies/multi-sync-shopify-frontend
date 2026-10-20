import { afterEach, expect, it, vi } from "vitest";
import { metaRequest } from "../app/services/meta-types";

afterEach(() => vi.unstubAllGlobals());

it("distinguishes Cloudflare origin errors from application permission denials", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          {
            status: 502,
            cloudflare_error: true,
            detail: "private proxy detail",
          },
          { status: 502 },
        ),
      ),
  );
  await expect(metaRequest({ intent: "confirm" })).rejects.toThrow(
    /development tunnel or server/,
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          {
            ok: false,
            code: "CATALOG_ACCESS_UNVERIFIED",
            error: "Meta rejected the catalog assignment check.",
          },
          { status: 403 },
        ),
      ),
  );
  await expect(metaRequest({ intent: "confirm" })).rejects.toThrow(
    "Meta rejected the catalog assignment check.",
  );
});

it("handles invalid or incomplete gateway responses and network failures safely", async () => {
  for (const response of [
    new Response("<html>private proxy page</html>", { status: 502 }),
    Response.json({ ok: false, error: { secret: "private" } }),
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(metaRequest()).rejects.not.toThrow(/private|object Object/);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("private network detail")),
  );
  await expect(metaRequest()).rejects.toThrow(
    "The Facebook connection service is unavailable. Try again.",
  );
});

it("returns success only for a successful application JSON response", async () => {
  const payload = { ok: true, connection: { status: "CONNECTED" } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
  await expect(metaRequest({ intent: "confirm" })).resolves.toEqual(payload);
});
