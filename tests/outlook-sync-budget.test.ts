// Bounded Outlook sync runs: a time budget stops new pages (never mid-page), a hard deadline aborts slow Graph calls,
// pending mail is finished first, progress is saved, the next run resumes without
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
  // Page 2 started at 10 s (inside the 15 s budget) and is finished whole, even though it ends at 20 s.
  assert.equal(first.counts.stored, 2);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.match((await h.state()).all_inbound_next_link, /skiptoken=p3/);
  assert.equal(h.requests.filter((r) => filterField(r.url) === "sentDateTime").length, 0, "outbound waits for the next run");
  assert.equal(h.requests.filter((r) => r.url.includes("skiptoken=p3")).length, 0, "no page is started after the budget");

  clock = 0;
  const second = await h.server.runOutlookSync({ budgetMs: 60_000, clock: () => clock });
  assert.equal(second.ok, true, second.blocker);
  assert.equal(second.partial, false);
  assert.equal(second.counts.stored, 1);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.equal((await h.state()).all_inbound_next_link, null);
  assert.equal(await total(h, "job_communications"), 3);
  assert.deepEqual((await h.db.query(`SELECT provider_message_id FROM job_communications ORDER BY 1`)).rows.map((r: any) => r.provider_message_id), ["m1", "m2", "m3"]);
}), 30_000);

test("a page that starts inside the budget is finished whole; the budget is only checked between pages", practice(async (h) => {
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
  assert.equal(first.counts.stored, 3, "every message on the started page is finished");
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.ok(Date.parse((await h.state()).all_inbound_cursor) >= Date.parse(at(3)));
  assert.equal(h.requests.filter((r) => filterField(r.url) === "sentDateTime").length, 0, "no new page after the budget");

  clock = 0;
  const second = await h.server.runOutlookSync({ budgetMs: 60_000, clock: () => clock });
  assert.equal(second.ok, true, second.blocker);
  assert.equal(second.counts.stored, 0);
  assert.equal(await total(h, "job_communications"), 3);
}), 30_000);

/** A fetch that never answers on its own: it only ends when the run's AbortSignal fires (or a 5 s safety stop). */
let abortedBySignal = false;
const hang = (options: RequestInit) => new Promise<Response>((_, reject) => {
  const signal = options.signal;
  if (!signal) return reject(new Error("Graph call has no AbortSignal"));
  if (signal.aborted) { abortedBySignal = true; return reject(signal.reason); }
  signal.addEventListener("abort", () => { abortedBySignal = true; reject(signal.reason); });
  setTimeout(() => reject(new Error("the run never aborted this Graph call")), 5_000);
});

test("a run that hits the hard deadline mid-Graph-call aborts it; the next run finishes that page with no loss or duplicates", practice(async (h) => {
  let clock = 0;
  let hangOn: string | null = "/messages/b/attachments";
  abortedBySignal = false;
  h.control.fetch = async (url, options) => {
    if (isIdentity(url) || isProbe(url)) return jsonResponse(isIdentity(url) ? { id: "d", mail: "delegate@example.test" } : { value: [] });
    if (hangOn && url.includes(hangOn)) return hang(options);
    // Finishing message a takes the run to 200 ms before the default 45 s hard deadline.
    if (url.includes("/messages/a/attachments")) { clock = h.server.OUTLOOK_SYNC_DEADLINE_MS - 200; return jsonResponse({ value: [] }); }
    if (url.includes("/attachments")) return jsonResponse({ value: [] });
    if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
    if (url.includes("skiptoken=p2")) return jsonResponse({ value: [graphMessage("a", "two-a", { receivedDateTime: at(2) }), graphMessage("b", "two-b", { receivedDateTime: at(3) })] });
    if (filterField(url) === "receivedDateTime") return jsonResponse({ value: [graphMessage("m1", "one", { receivedDateTime: at(1) })], "@odata.nextLink": NEXT(2) });
    return jsonResponse({ value: [] });
  };
  assert.equal(h.server.OUTLOOK_SYNC_DEADLINE_MS, 45_000);
  const first = await h.server.runOutlookSync({ clock: () => clock });
  assert.equal(abortedBySignal, true, "the run's deadline signal aborted the hanging Graph call");
  assert.equal(first.ok, false);
  // Page 1 was saved; page 2 was not, so it is re-read next run. Its unfinished message waits as pending work.
  const state = await h.state();
  assert.match(state.all_inbound_next_link, /skiptoken=p2/);
  const pending = (await h.db.query<{ provider_message_id: string; last_error: string }>(`SELECT provider_message_id,last_error FROM outlook_message_work WHERE status='pending'`)).rows;
  assert.deepEqual(pending.map((r) => r.provider_message_id), ["b"]);
  assert.match(pending[0]!.last_error, /too long/i);

  hangOn = null; clock = 0;
  const second = await h.server.runOutlookSync({ clock: () => clock });
  assert.equal(second.ok, true, second.blocker);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.equal((await h.state()).all_inbound_next_link, null);
  assert.deepEqual((await h.db.query(`SELECT provider_message_id FROM job_communications ORDER BY 1`)).rows.map((r: any) => r.provider_message_id), ["a", "b", "m1"]);
}), 30_000);

test("pending mail from an earlier run is finished before any new page is read", practice(async (h) => {
  let attachmentsDown = true;
  h.control.fetch = async (url) => {
    if (isIdentity(url) || isProbe(url)) return jsonResponse(isIdentity(url) ? { id: "d", mail: "delegate@example.test" } : { value: [] });
    if (url.includes("/attachments")) return attachmentsDown && url.includes("/messages/old-1/") ? jsonResponse({}, 503) : jsonResponse({ value: [] });
    if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
    if (filterField(url) === "receivedDateTime") return jsonResponse({ value: [graphMessage("old-1", "old", { receivedDateTime: at(1) }), ...(attachmentsDown ? [] : [graphMessage("new-1", "new", { receivedDateTime: at(2) })])] });
    return jsonResponse({ value: [] });
  };
  const first = await h.server.runOutlookSync();
  assert.equal(first.ok, false);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 1);

  attachmentsDown = false; h.requests.length = 0;
  const second = await h.server.runOutlookSync();
  assert.equal(second.ok, true, second.blocker);
  const finishedOld = h.requests.findIndex((r) => r.url.includes("/messages/old-1/attachments"));
  const firstPage = h.requests.findIndex((r) => filterField(r.url) === "receivedDateTime");
  assert.ok(finishedOld >= 0 && firstPage >= 0);
  assert.ok(finishedOld < firstPage, "pending mail is finished before the inbound page is read");
  assert.equal(h.requests.filter((r) => r.url.includes("/messages/old-1/attachments")).length, 1, "old mail is finished once");
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.deepEqual((await h.db.query(`SELECT provider_message_id FROM job_communications ORDER BY 1`)).rows.map((r: any) => r.provider_message_id), ["new-1", "old-1"]);
}), 30_000);

test("a Graph 429 mid-run with pending mail loses nothing, and the next run completes", practice(async (h) => {
  let phase = 1;
  h.control.fetch = async (url) => {
    if (isIdentity(url) || isProbe(url)) return jsonResponse(isIdentity(url) ? { id: "d", mail: "delegate@example.test" } : { value: [] });
    if (url.includes("/attachments")) return phase === 1 && url.includes("/messages/old-1/") ? jsonResponse({}, 429) : jsonResponse({ value: [] });
    if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
    if (url.includes("skiptoken=p2")) return phase === 2 ? jsonResponse({}, 429) : jsonResponse({ value: [graphMessage("new-2", "two", { receivedDateTime: at(3) })] });
    if (filterField(url) === "receivedDateTime") return phase === 1
      ? jsonResponse({ value: [graphMessage("old-1", "old", { receivedDateTime: at(1) })] })
      : jsonResponse({ value: [graphMessage("old-1", "old", { receivedDateTime: at(1) }), graphMessage("new-1", "one", { receivedDateTime: at(2) })], "@odata.nextLink": NEXT(2) });
    return jsonResponse({ value: [] });
  };
  const first = await h.server.runOutlookSync();
  assert.equal(first.ok, false);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 1);

  phase = 2;
  const second = await h.server.runOutlookSync();
  assert.equal(second.ok, false);
  assert.match(second.blocker, /429/);
  // The pending mail and page 1 are done and saved; page 2 is re-read next run.
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.match((await h.state()).all_inbound_next_link, /skiptoken=p2/);
  assert.equal(await total(h, "job_communications"), 2);

  phase = 3;
  const third = await h.server.runOutlookSync();
  assert.equal(third.ok, true, third.blocker);
  assert.equal(await total(h, "outlook_message_work", "WHERE status='pending'"), 0);
  assert.deepEqual((await h.db.query(`SELECT provider_message_id FROM job_communications ORDER BY 1`)).rows.map((r: any) => r.provider_message_id), ["new-1", "new-2", "old-1"]);
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

test("a run reports named per-step timings that add up within the total", practice(async (h) => {
  let clock = 0;
  h.control.fetch = async (url) => isIdentity(url) ? jsonResponse({ id: "d", mail: "delegate@example.test" }) : jsonResponse({ value: [] });
  const r = await h.server.runOutlookSync({ clock: () => (clock += 7) });
  assert.equal(r.ok, true, r.blocker);
  assert.deepEqual(Object.keys(r.timingsMs).sort(), ["identity", "inbound", "outbound", "resume", "total"]);
  const steps = r.timingsMs.identity + r.timingsMs.inbound + r.timingsMs.outbound + r.timingsMs.resume;
  for (const k of ["identity", "inbound", "outbound", "resume"]) assert.ok(r.timingsMs[k] > 0, k);
  assert.ok(r.timingsMs.total >= steps, `total ${r.timingsMs.total} >= steps ${steps}`);
}), 30_000);
