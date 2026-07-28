import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FEED_REFRESH_SCHEDULE,
  feedRefreshDraftFingerprint,
  formatTime12,
  isAutomaticRefreshActive,
  parseTime24,
  scheduleDraftFrom,
  time24From12,
} from "../app/services/feed-refresh-query.ts";

test("the default automatic refresh schedule uses midnight UTC overrides", () => {
  assert.deepEqual(DEFAULT_FEED_REFRESH_SCHEDULE, {
    customAutomaticRefresh: false,
    customTime: null,
    customTimezone: null,
  });
  assert.equal(
    feedRefreshDraftFingerprint(DEFAULT_FEED_REFRESH_SCHEDULE),
    JSON.stringify([false, null, null]),
  );
});

test("12-hour selections normalize to valid 24-hour times", () => {
  assert.equal(time24From12(12, 0, "AM"), "00:00");
  assert.equal(time24From12(12, 0, "PM"), "12:00");
  assert.equal(time24From12(11, 34, "AM"), "11:34");
  assert.equal(time24From12(11, 34, "PM"), "23:34");
  assert.equal(time24From12(0, 0, "AM"), null);
  assert.equal(time24From12(12, 60, "PM"), null);
});

test("stored times are parsed strictly and displayed with AM/PM", () => {
  assert.deepEqual(parseTime24("00:00"), { hour: 0, minute: 0 });
  assert.deepEqual(parseTime24("23:59"), { hour: 23, minute: 59 });
  assert.equal(parseTime24("7:30"), null);
  assert.equal(parseTime24("24:00"), null);
  assert.equal(formatTime12("00:00"), "12:00 AM");
  assert.equal(formatTime12("12:00"), "12:00 PM");
  assert.equal(formatTime12("23:34"), "11:34 PM");
});

test("saved custom settings hydrate while default schedules clear overrides", () => {
  assert.deepEqual(
    scheduleDraftFrom({
      customAutomaticRefresh: true,
      customTime: "08:15",
      customTimezone: "Europe/Brussels",
    }),
    {
      customAutomaticRefresh: true,
      customTime: "08:15",
      customTimezone: "Europe/Brussels",
    },
  );
  assert.deepEqual(
    scheduleDraftFrom({
      customAutomaticRefresh: false,
      customTime: "08:15",
      customTimezone: "Europe/Brussels",
    }),
    DEFAULT_FEED_REFRESH_SCHEDULE,
  );
});

test("only queued and processing automatic attempts hold the UI lock", () => {
  assert.equal(isAutomaticRefreshActive("QUEUED"), true);
  assert.equal(isAutomaticRefreshActive("PROCESSING"), true);
  assert.equal(isAutomaticRefreshActive("SUCCESS"), false);
  assert.equal(isAutomaticRefreshActive("FAILED"), false);
  assert.equal(isAutomaticRefreshActive("NEVER_RUN"), false);
  assert.equal(isAutomaticRefreshActive(undefined), false);
});
