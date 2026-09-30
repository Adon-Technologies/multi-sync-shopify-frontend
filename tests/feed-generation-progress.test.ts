import assert from "node:assert/strict";
import test from "node:test";
import { formatFeedGenerationProgress } from "../app/services/feed-generation-state.ts";

test("Free progress shows the output limit without implying the whole catalog must be scanned", () => {
  assert.equal(
    formatFeedGenerationProgress(
      { status: "PROCESSING", processedProducts: 10, totalProducts: 54 },
      10,
    ),
    "10 products checked · Up to 10 products per feed",
  );
});
test("checking excluded products does not make the Free output allowance look larger", () => {
  assert.equal(
    formatFeedGenerationProgress(
      { status: "PROCESSING", processedProducts: 15, totalProducts: 200 },
      10,
    ),
    "15 products checked · Up to 10 products per feed",
  );
});
test("Free progress explains discovery before the first product is checked", () => {
  assert.equal(
    formatFeedGenerationProgress(
      { status: "PROCESSING", processedProducts: 0, totalProducts: null },
      10,
    ),
    "Finding eligible products · Up to 10 products per feed",
  );
});
test("Pro retains full catalog progress", () => {
  assert.equal(
    formatFeedGenerationProgress(
      { status: "PROCESSING", processedProducts: 54, totalProducts: 200 },
      null,
    ),
    "54 of 200 products",
  );
});
test("queued and completed feeds do not display misleading processing progress", () => {
  assert.equal(
    formatFeedGenerationProgress(
      { status: "QUEUED", processedProducts: 0, totalProducts: null },
      10,
    ),
    "Waiting for the feed worker",
  );
  assert.equal(
    formatFeedGenerationProgress(
      { status: "COMPLETED", processedProducts: 10, totalProducts: 54 },
      10,
    ),
    null,
  );
});
