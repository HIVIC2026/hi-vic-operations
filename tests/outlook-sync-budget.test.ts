// Bounded Outlook sync runs: a time budget stops new work, progress is saved, the next run resumes without
// loss or duplicates; identity/permission is read once per run; completed work rows are never re-processed.
import { test } from "bun:test";
import assert from "node:assert/strict";
import { outlookHarness, graphMessage, jsonResponse, TEST_MAILBOX } from "./helpers/outlook-recovery-harness.ts";

type Harness = Awaited<ReturnType<typeof outlookHarness>>;
const practice = (fn: (h: Harness) => Promise<void>) => async () => {
  const h = await outlookHarness();
  try { await h.db.query(`UPDATE outlook_sync_state SET expected_mailbox=$1`, [TEST_MAILBOX]); await fn(h); } finally { await h.db.close(); }
};
const total = async (h: Harness, table: string, where = "") => Number((await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} ${where}`)).rows[0]!.n);
const filterField = (url: string) => new URL(url).searchParams.get("$filter")?.split(" ")[0] ?? "";
const NEXT = (n: number) => `https://graph.microsoft.com/v1.0/users/shared%40example.test/messages?$skiptoken=p${n}`;
const isIdentity = (url: string) => url.includes("/me?");
const isProbe = (url: string) => url.includes("$select=id,body");
const at = (minute: number) => `2026-10-20T08:${String(minute).padStart(2, "0")}:00Z`;

test("a run stops starting new pages at the budget, saves its place, and the next run finishes without loss or duplicates", practice(async (h) => {
  let clock = 0;
  h.control.fetch = async (url) => {
    if (isIdentity(url) || isProbe(url)) return jsonResponse(isIdentity(url) ? { id: "d", mail: "delegate@example.test" } : { value: [] });
    if (url.includes("/attachments")) return jsonResponse({ value: [] });
    if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
    clock += 10_000; // each inbound page costs 10 s
    if (url.includes("skiptoken=p2")) return jsonResponse({ value: [graphMessage("m2", "two", { receivedDateTime: at(2) })], "@odata.nextLink": NEXT(3) });
    if (url.includes("skiptoken=p3")) return jsonResponse({ value: [graphMessage("m3", "three", { receivedDateTime: at(3) })] });
    return jsonResponse({ value: [graphMessage("m1", "one", { receivedDateTime: at(1) })], "@odata.nextLink": NEXT(2) });
  };
  const first = await h.server.runOutlookSync({ budgetMs: 15_000, clock: () => clock });
  assert.equal(first.ok, true, first.blocker);
  assert.equal(first.partial, true);
  // Page 2 was read at 20 s (past the 15 s budget): it is reserved, its message waits as pending work.
  assert.equal(first.counts.stored, 1);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 1);
  assert.match((await h.state()).all_inbound_next_link, /skiptoken=p3/);
  assert.equal(h.requests.filter((r) => filterField(r.url) === "sentDateTime").length, 0, "outbound waits for the next run");
  assert.equal(h.requests.filter((r) => r.url.includes("skiptoken=p3")).length, 0, "no page is started after the budget");

  clock = 0;
  const second = await h.server.runOutlookSync({ budgetMs: 60_000, clock: () => clock });
  assert.equal(second.ok, true, second.blocker);
  assert.equal(second.partial, false);
  assert.equal(second.counts.stored, 2); // page 3 plus the pending message from page 2
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.equal((await h.state()).all_inbound_next_link, null);
  assert.equal(await total(h, "job_communications"), 3);
  assert.deepEqual((await h.db.query(`SELECT provider_message_id FROM job_communications ORDER BY 1`)).rows.map((r: any) => r.provider_message_id), ["m1", "m2", "m3"]);
}), 30_000);

test("a run that hits the budget mid-page keeps the reserved messages pending and the next run finishes each once", practice(async (h) => {
  let clock = 0;
  let pageServed = false;
  h.control.fetch = async (url) => {
    if (isIdentity(url) || isProbe(url)) return jsonResponse(isIdentity(url) ? { id: "d", mail: "delegate@example.test" } : { value: [] });
    if (url.includes("/attachments")) { clock += 10_000; return jsonResponse({ value: [] }); } // each message finish costs 10 s
    if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
    if (pageServed) return jsonResponse({ value: [] });
    pageServed = true;
    return jsonResponse({ value: [1, 2, 3].map((n) => graphMessage(`mid-${n}`, `msg ${n}`, { receivedDateTime: at(n) }))});
  };
  const first = await h.server.runOutlookSync({ budgetMs: 5_000, clock: () => clock });
  assert.equal(first.ok, true, first.blocker);
  assert.equal(first.partial, true);
  assert.equal(first.counts.stored, 1);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 2, "the rest are durably reserved");
  // The whole page is reserved, so the cursor may move past it: nothing on it can be lost.
  assert.ok(Date.parse((await h.state()).all_inbound_cursor) >= Date.parse(at(3)));

  clock = 0;
  const second = await h.server.runOutlookSync({ budgetMs: 60_000, clock: () => clock });
  assert.equal(second.ok, true, second.blocker);
  assert.equal(second.counts.stored, 2);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.equal(await total(h, "job_communications"), 3);
  const third = await h.server.runOutlookSync({ budgetMs: 60_000, clock: () => clock });
  assert.equal(third.ok, true, third.blocker);
  assert.equal(third.counts.stored, 0);
  assert.equal(await total(h, "job_communications"), 3);
}), 30_000);

test("identity and mailbox permission are read once per run (2 folder probes, never 4)", practice(async (h) => {
  h.control.fetch = async (url) => isIdentity(url) ? jsonResponse({ id: "d", mail: "delegate@example.test" }) : jsonResponse({ value: [] });
  const ok = await h.server.runOutlookSync();
  assert.equal(ok.ok, true, ok.blocker);
  assert.equal(h.requests.filter((r) => isIdentity(r.url)).length, 1);
  assert.equal(h.requests.filter((r) => isProbe(r.url)).length, 2);

  // Mail-only connection: /me is refused, the probes prove access — still only two probes in the run.
  h.requests.length = 0;
  h.control.fetch = async (url) => isIdentity(url) ? jsonResponse({}, 403) : jsonResponse({ value: [] });
  const mailOnly = await h.server.runOutlookSync();
  assert.equal(mailOnly.ok, true, mailOnly.blocker);
  assert.equal(h.requests.filter((r) => isIdentity(r.url)).length, 1);
  assert.equal(h.requests.filter((r) => isProbe(r.url)).length, 2);
}), 30_000);

test("completed work rows are never re-processed: a re-listed page does no per-message work", practice(async (h) => {
  const page = [1, 2, 3, 4, 5].map((n) => graphMessage(`done-${n}`, `msg ${n}`, { receivedDateTime: at(n) }));
  h.control.fetch = async (url) => {
    if (isIdentity(url)) return jsonResponse({ id: "d", mail: "delegate@example.test" });
    if (filterField(url) === "receivedDateTime") return jsonResponse({ value: page });
    return jsonResponse({ value: [] });
  };
  const first = await h.server.runOutlookSync();
  assert.equal(first.ok, true, first.blocker);
  assert.equal(first.counts.stored, 5);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='complete'"), 5);

  h.operations.length = 0; h.requests.length = 0;
  const second = await h.server.runOutlookSync();
  assert.equal(second.ok, true, second.blocker);
  assert.equal(second.counts.duplicate, 5); assert.equal(second.counts.stored, 0);
  assert.equal(h.operations.filter((o) => o.mode === "rpc").length, 0, "no begin/finish calls for completed rows");
  assert.equal(h.requests.filter((r) => r.url.includes("/attachments")).length, 0, "no attachment fetches for completed rows");
  // One batched work lookup for the page, not one per message.
  assert.equal(h.operations.filter((o) => o.table === "outlook_message_work" && o.mode === "read" && o.filters.some((f) => f.field === "provider_message_id")).length, 1);
  assert.equal(await total(h, "job_communications"), 5);
}), 30_000);

test("progress is saved after each page, so a later page failure does not repeat finished pages", practice(async (h) => {
  h.control.fetch = async (url) => {
    if (isIdentity(url)) return jsonResponse({ id: "d", mail: "delegate@example.test" });
    if (url.includes("/attachments")) return jsonResponse({ value: [] });
    if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
    if (url.includes("skiptoken=p2")) return jsonResponse({}, 503);
    if (filterField(url) === "receivedDateTime") return jsonResponse({ value: [graphMessage("cp-1", "one", { receivedDateTime: at(1) })], "@odata.nextLink": NEXT(2) });
    return jsonResponse({ value: [] });
  };
  const run = await h.server.runOutlookSync();
  assert.equal(run.ok, false);
  const state = await h.state();
  assert.match(state.all_inbound_next_link, /skiptoken=p2/);
  assert.ok(Date.parse(state.all_inbound_cursor) >= Date.parse(at(1)));
  assert.ok(state.last_error);
  assert.equal(await total(h, "job_communications"), 1);
}), 30_000);

test("a run reports per-step timings", practice(async (h) => {
  h.control.fetch = async (url) => isIdentity(url) ? jsonResponse({ id: "d", mail: "delegate@example.test" }) : jsonResponse({ value: [] });
  const r = await h.server.runOutlookSync();
  assert.equal(r.ok, true, r.blocker);
  for (const k of ["identity", "inbound", "outbound", "resume", "total"]) assert.equal(typeof r.timingsMs[k], "number", k);
}), 30_000);
