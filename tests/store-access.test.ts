import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const shopifySource = readFileSync(
  new URL("../app/shopify.server.ts", import.meta.url),
  "utf8",
);
const accessSource = readFileSync(
  new URL("../app/services/store-access.server.ts", import.meta.url),
  "utf8",
);

test("installation and admin access remain separate Store states", () => {
  assert.match(schemaSource, /enum StoreStatus \{[\s\S]*INSTALLED[\s\S]*UNINSTALLED/);
  assert.match(
    schemaSource,
    /enum StoreAccessStatus \{[\s\S]*ACTIVE[\s\S]*SUSPENDED/,
  );
  assert.match(
    schemaSource,
    /accessStatus\s+StoreAccessStatus\s+@default\(ACTIVE\)/,
  );
});

test("authenticated Shopify app routes reject suspended stores server-side", () => {
  assert.match(shopifySource, /authenticateActiveAdmin/);
  assert.match(shopifySource, /assertStoreAccessAllowed\(context\.session\.shop\)/);
  assert.match(accessSource, /code:\s*"STORE_SUSPENDED"/);
  assert.match(accessSource, /status:\s*403/);
});
