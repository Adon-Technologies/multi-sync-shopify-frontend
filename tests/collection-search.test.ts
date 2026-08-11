import assert from "node:assert/strict";
import test from "node:test";

import { buildCollectionSearch } from "../app/services/collection-search.ts";

test("collection search uses Shopify title-prefix clauses without quoting wildcards", () => {
  assert.equal(buildCollectionSearch(""), null);
  assert.equal(buildCollectionSearch("men"), "title:men*");
  assert.equal(
    buildCollectionSearch("Women's Collection"),
    "title:Women's* title:Collection*",
  );
  assert.equal(
    buildCollectionSearch("Testing Collection 2"),
    "title:Testing* title:Collection* title:2*",
  );
});

test("collection search escapes Shopify control characters without disabling prefix matching", () => {
  assert.equal(
    buildCollectionSearch('Kids: (Sale*) "2026"'),
    'title:Kids\\:* title:\\(Sale\\*\\)* title:\\"2026\\"*',
  );
});
