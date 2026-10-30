// AI replies step 4 re-review: the sync says whether this tick was a complete normal sync (inbound AND Sent Items pulled
// right up to now). Only then may AI replies send themselves — otherwise Jo's own reply may not be in yet.
import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outlookHarness, jsonResponse, TEST_MAILBOX } from "./helpers/outlook-recovery-harness.ts";

type Harness = Awaited<ReturnType<typeof outlookHarness>>;
const filterField = (url: string) => new URL(url).searchParams.get("$filter")?.split(" ")[0] ?? "";
const NEXT = "https://graph.microsoft.com/v1.0/users/shared%40example.test/messages?$skiptoken=next";
const practice = (fn: (h: Harness) => Promise<void>) => async () => {
  const h = await outlookHarness();
  try {
    await h.db.query(`UPDATE outlook_sync_state SET expected_mailbox=$1`, [TEST_MAILBOX]);
    await fn(h);
  } finally { await h.db.close(); }
};
const identity = (url: string) => url.includes("/me?") ? jsonResponse({ id: "delegate-id", mail: "delegate@example.test", displayName: "Test delegate" }) : null;

test("a normal tick with both directions pulled to now is complete", practice(async (h) => {
  h.control.fetch = async (url) => identity(url) ?? jsonResponse({ value: [] });
  const r = await h.server.runOutlookSync({ maxPages: 1 });
  assert.equal(r.ok, true, r.blocker);
  assert.equal(r.complete, true);
}));

test("Sent Items with a next link left over: ok but not complete", practice(async (h) => {
  h.control.fetch = async (url) => identity(url)
    ?? (filterField(url) === "sentDateTime" ? jsonResponse({ value: [], "@odata.nextLink": NEXT }) : jsonResponse({ value: [] }));
  const r = await h.server.runOutlookSync({ maxPages: 1 });
  assert.equal(r.ok, true, r.blocker);
  assert.equal(r.complete, false);
}));

test("inbound with a next link left over: not complete", practice(async (h) => {
  h.control.fetch = async (url) => identity(url)
    ?? (filterField(url) === "receivedDateTime" ? jsonResponse({ value: [], "@odata.nextLink": NEXT }) : jsonResponse({ value: [] }));
  const r = await h.server.runOutlookSync({ maxPages: 1 });
  assert.equal(r.ok, true, r.blocker);
  assert.equal(r.complete, false);
}));

test("a saved Sent Items continuation finished this tick still isn't complete (it stops at an older cutoff)", practice(async (h) => {
  await h.db.query(`UPDATE outlook_sync_state SET all_outbound_next_link=$1, all_outbound_cursor='2026-10-20T00:00:00Z'`, [NEXT]);
  h.control.fetch = async (url) => identity(url) ?? jsonResponse({ value: [] });
  const r = await h.server.runOutlookSync({ maxPages: 1 });
  assert.equal(r.ok, true, r.blocker);
  assert.equal(r.complete, false);
}));

test("a catch-up tick is never complete", practice(async (h) => {
  await h.db.exec(`UPDATE outlook_sync_state SET catchup_from='2026-10-01T00:00:00Z', backfill_from='2026-10-10T00:00:00Z'`);
  h.control.fetch = async (url) => identity(url) ?? jsonResponse({ value: [] });
  const r = await h.server.runOutlookSync({ maxPages: 1 });
  assert.equal(r.ok, true, r.blocker);
  assert.equal(r.complete, false);
}));

test("the route only lets AI replies send after a complete ok sync", () => {
  const route = readFileSync("src/routes/api/public/hooks/outlook-sync.ts", "utf8");
  assert.match(route, /sweepHeldAutoReplies\(new Date\(\), \{ syncOk: r\.ok && r\.complete \}\)/);
});
