import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), backend: vi.fn() }));
vi.mock("../app/shopify.server", () => ({
  authenticateActiveAdmin: mocks.authenticate,
}));
vi.mock("../app/services/feed-backend.server", () => ({
  requestFeedBackend: mocks.backend,
  FeedBackendError: class extends Error {
    constructor(
      message: string,
      public status = 502,
    ) {
      super(message);
    }
  },
}));
import { action, loader } from "../app/routes/app.meta-data";
import { FeedBackendError } from "../app/services/feed-backend.server";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHOPIFY_APP_URL", "https://app.example");
  mocks.authenticate.mockResolvedValue({
    session: { shop: "mine.myshopify.com", accessToken: "server-only" },
    sessionToken: { sub: "staff-123" },
  });
  mocks.backend.mockResolvedValue({ ok: true, connection: null });
});
afterEach(() => vi.unstubAllEnvs());

it("accepts the configured public app origin through an internal development proxy", async () => {
  vi.stubEnv("SHOPIFY_APP_URL", "https://local-preview.trycloudflare.com/");
  const response = await action({
    request: new Request("http://localhost:61543/app/meta-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://local-preview.trycloudflare.com",
      },
      body: JSON.stringify({ intent: "start" }),
    }),
    params: {},
    context: {},
    unstable_pattern: "app/meta-data",
  });
  expect(response.status).toBe(200);
  expect(mocks.backend).toHaveBeenCalledOnce();
  expect(mocks.backend.mock.calls[0][3].intent).toBe("start");
});

it("ignores forged forwarding headers and rejects unrelated origins behind a proxy", async () => {
  vi.stubEnv("SHOPIFY_APP_URL", "https://local-preview.trycloudflare.com");
  for (const origin of [
    "https://evil.example",
    "https://local-preview.trycloudflare.com.evil.example",
    "null",
  ]) {
    const response = await action({
      request: new Request("http://localhost:61543/app/meta-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-Forwarded-Host": origin.replace("https://", ""),
          "X-Forwarded-Proto": "https",
        },
        body: JSON.stringify({ intent: "start" }),
      }),
      params: {},
      context: {},
      unstable_pattern: "app/meta-data",
    });
    expect(response.status).toBe(403);
  }
  expect(mocks.backend).not.toHaveBeenCalled();
});
it("both reads and writes require Shopify authorization", async () => {
  mocks.authenticate.mockRejectedValue(
    new Response("Unauthorized", { status: 401 }),
  );
  for (const handler of [action, loader])
    await expect(
      handler({
        request: new Request("https://app.example/app/meta-data"),
        params: {},
        context: {},
        unstable_pattern: "app/meta-data",
      }),
    ).rejects.toBeInstanceOf(Response);
  expect(mocks.backend).not.toHaveBeenCalled();
});
it("actor and store identity come exclusively from verified Shopify context", async () => {
  await action({
    request: new Request("https://app.example/app/meta-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://app.example",
      },
      body: JSON.stringify({
        intent: "disconnect",
        actorId: "attacker",
        storeId: "foreign",
        shop: "foreign.myshopify.com",
        status: "CONNECTED",
        access: { productWrite: "VERIFIED" },
      }),
    }),
    params: {},
    context: {},
    unstable_pattern: "app/meta-data",
  });
  const [session, method, path, input, options] = mocks.backend.mock.calls[0];
  expect(session.shop).toBe("mine.myshopify.com");
  expect(method).toBe("POST");
  expect(path).toBe("/api/integrations/meta");
  expect(input.actorId).toMatch(/^[a-f0-9]{64}$/);
  expect(input.actorId).not.toBe("attacker");
  expect(input.storeId).toBeUndefined();
  expect(input.shop).toBeUndefined();
  expect(input.status).toBeUndefined();
  expect(input.access).toBeUndefined();
  expect(options).toEqual({
    readOnlyStore: true,
    signal: expect.any(AbortSignal),
  });
});
it("cross-origin and form posts are rejected before contacting the backend", async () => {
  for (const headers of [
    { Origin: "https://evil.example", "Content-Type": "application/json" },
    { "Content-Type": "application/x-www-form-urlencoded" },
  ] as Record<string, string>[]) {
    const response = await action({
      request: new Request("https://app.example/app/meta-data", {
        method: "POST",
        headers,
        body: "{}",
      }),
      params: {},
      context: {},
      unstable_pattern: "app/meta-data",
    });
    expect(response.status).toBe(403);
  }
  expect(mocks.backend).not.toHaveBeenCalled();
});
it("authenticated reads are private and contain no credentials", async () => {
  const response = await loader({
    request: new Request("https://app.example/app/meta-data"),
    params: {},
    context: {},
    unstable_pattern: "app/meta-data",
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).not.toMatch(/server-only|secret|accessToken/);
  expect(mocks.backend.mock.calls[0][2]).toMatch(
    /^\/api\/integrations\/meta\?actorId=[a-f0-9]{64}$/,
  );
});

const post = (body = '{"intent":"confirm"}') =>
  action({
    request: new Request("https://app.example/app/meta-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://app.example",
      },
      body,
    }),
    params: {},
    context: {},
    unstable_pattern: "app/meta-data",
  });
it("rejects malformed or non-object JSON before contacting the backend", async () => {
  for (const body of ["{", "null", "[]", '"text"']) {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
  }
  expect(mocks.backend).not.toHaveBeenCalled();
});
it("preserves controlled backend denials and catches unexpected backend and authentication exceptions", async () => {
  mocks.backend.mockRejectedValue(
    new FeedBackendError("Manage catalog access could not be verified.", 403),
  );
  let response = await post();
  expect(response.status).toBe(403);
  expect((await response.json()).error).toMatch(/Manage catalog/);
  mocks.backend.mockRejectedValue(new Error("private backend stack"));
  response = await post();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/private|stack/);
  mocks.authenticate.mockRejectedValue(
    new Error("private authentication stack"),
  );
  response = await post();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/private|stack/);
});
it("bounds the Meta backend request and returns complete timeout JSON", async () => {
  const controller = new AbortController();
  const spy = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  try {
    mocks.backend.mockImplementation(async () => {
      controller.abort();
      throw new Error("private transport");
    });
    const response = await post();
    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("META_BACKEND_TIMEOUT");
  } finally {
    spy.mockRestore();
  }
});
