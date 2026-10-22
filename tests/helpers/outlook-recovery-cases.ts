import assert from "node:assert/strict";
import { outlookHarness, graphMessage, jsonResponse, bytesResponse, migration, rollback, TEST_ACTOR, TEST_JOB, TEST_MAILBOX } from "./outlook-recovery-harness.ts";
import { attachmentIdentityKey } from "../../src/lib/outlook-correspondence.core";

type Harness = Awaited<ReturnType<typeof outlookHarness>>;
// Isolated processing fault cases receive the worker's proven-window boundary explicitly.
// The runOutlookSync cases below establish (or fail to establish) that boundary through actual pages.
const COMPLETE_WINDOW = { inboxCompleteThrough: "2026-10-20T10:00:00Z" };
const row = async (h: Harness, table: string, fields = "*") => (await h.db.query(`SELECT ${fields} FROM ${table} LIMIT 1`)).rows[0] as any;
const total = async (h: Harness, table: string) => Number((await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n);
const expectPending = async (h: Harness) => {
  assert.equal((await row(h, "jobs")).stage, "new_enquiry");
  assert.equal(await total(h, "job_communications"), 0);
  assert.equal((await row(h, "outlook_message_work")).status, "pending");
};
const configured = async (h: Harness) => { await h.db.query(`UPDATE outlook_sync_state SET expected_mailbox=$1`, [TEST_MAILBOX]); };
const readOnlyResponses = (url: string) => url.includes("/me?")
  ? jsonResponse({ id: "delegate-id", mail: "delegate@example.test", displayName: "Test delegate" })
  : jsonResponse({ value: [] });
// The message-list $select also mentions both date fields, so direction is matched on the $filter field, not URL text.
const filterField = (url: string) => new URL(url).searchParams.get("$filter")?.split(" ")[0] ?? "";
const practice = (fn: (h: Harness) => Promise<void>) => async () => {
  const h = await outlookHarness();
  try { await fn(h); } finally { await h.db.close(); }
};

export const outlookRecoveryCases: [string, () => Promise<void>][] = [
  ["before-use rollback preserves legacy correspondence; rollback refuses a populated recovery queue", practice(async h => {
    await h.db.query(`INSERT INTO job_communications(job_id,direction,channel,body) VALUES($1,'inbound','email','preserve this historical row')`, [TEST_JOB]);
    await h.db.exec(rollback());
    assert.equal(await total(h, "job_communications"), 1);
    assert.equal((await h.db.query(`SELECT 1 FROM pg_tables WHERE tablename='outlook_message_work'`)).rows.length, 0);
    await h.db.exec(migration());
    const result = h.counts(); await h.server.processMessages([graphMessage("after-reapply")], TEST_MAILBOX, result);
    assert.equal(result.stored, 1);
    await assert.rejects(h.db.exec(rollback()), /preserve its queue/);
    assert.equal(await total(h, "job_communications"), 2);
  })],
  ["gateway credentials stay on approved HTTPS paths; opaque continuation tokens survive", practice(async h => {
    const gateway = "https://connector-gateway.lovable.dev/microsoft_outlook";
    const input = "https://graph.microsoft.com/v1.0/users/shared%40example.test/mailFolders/inbox/messages?$skiptoken=a%2Bb%2F%3D";
    assert.equal(h.connection.outlookGatewayUrl(input), `${gateway}/users/shared%40example.test/mailFolders/inbox/messages?$skiptoken=a%2Bb%2F%3D`);
    for (const bad of ["https://evil.example/me", "http://graph.microsoft.com/v1.0/me/messages", "//evil.example/me", "https://x@graph.microsoft.com/v1.0/me/messages", "https://graph.microsoft.com/v1.0/me/messages#token", "https://graph.microsoft.com:444/v1.0/me/messages", "https://connector-gateway.lovable.dev/other/me", "https://graph.microsoft.com/v1.0/groups/g/messages", "https://graph.microsoft.com.evil.example/v1.0/me/messages"])
      assert.throws(() => h.connection.outlookGatewayUrl(bad));
    assert.equal(h.connection.outlookMailboxPath(" SHARED@EXAMPLE.TEST "), "/users/shared%40example.test");
  })],
  ["read-only shared mailbox health separates delegate identity; explicit confirmation is audited", practice(async h => {
    h.control.fetch = async url => readOnlyResponses(url);
    const health = await h.server.checkOutlookConnection(TEST_MAILBOX);
    assert.equal(health.authenticatedAccount.email, "delegate@example.test");
    assert.equal(health.targetMailbox, TEST_MAILBOX);
    assert.equal(health.mailboxReadable, true);
    assert.equal(health.readyForSync, false);
    assert.equal((await h.state()).expected_mailbox, null);
    assert.ok(h.operations.every(op => op.mode === "read"));
    assert.equal(await total(h, "outlook_message_work"), 0);
    assert.equal(await total(h, "admin_config_events"), 0);
    assert.ok(h.requests.every(r => r.options.method === "GET" && r.options.redirect === "error"));
    assert.equal(h.requests.filter(r => r.url.includes(`/users/shared%40example.test/mailFolders/`)).length, 2);
    await h.server.confirmOutlookMailbox(TEST_MAILBOX, TEST_ACTOR);
    assert.equal((await h.state()).expected_mailbox, TEST_MAILBOX);
    assert.equal(await total(h, "admin_config_events"), 1);
    assert.equal((await h.server.checkOutlookConnection()).readyForSync, true);
    await h.server.confirmOutlookMailbox(TEST_MAILBOX, TEST_ACTOR);
    assert.equal(await total(h, "admin_config_events"), 1);
  })],
  ["an old last-synced mailbox is not an explicit target; unconfigured sync is blocked", practice(async h => {
    await h.db.query(`UPDATE outlook_sync_state SET mailbox=$1`, [TEST_MAILBOX]);
    h.control.fetch = async url => readOnlyResponses(url);
    const health = await h.server.checkOutlookConnection();
    assert.equal(health.status, "account_connected");
    assert.equal(health.targetMailbox, null);
    assert.equal(health.readyForSync, false);
    assert.equal(h.requests.length, 1);
    const result = await h.server.runOutlookSync();
    assert.equal(result.ok, false);
    assert.match(result.blocker, /shared business mailbox address/);
    assert.equal(h.requests.length, 1);
    assert.equal(await total(h, "outlook_message_work"), 0);
    assert.equal((await h.state()).expected_mailbox, null);
  })],
  ["denied shared access remains failed, preserving the delegate identity without provider error bodies", practice(async h => {
    await configured(h);
    h.control.fetch = async url => url.includes("/me?") ? readOnlyResponses(url) : jsonResponse({ secret: "do-not-echo-provider-body" }, 403);
    const health = await h.server.checkOutlookConnection();
    assert.equal(health.status, "failed"); assert.equal(health.readyForSync, false);
    assert.equal(health.authenticatedAccount.email, "delegate@example.test");
    assert.match(health.problem, /HTTP 403/); assert.doesNotMatch(health.problem, /do-not-echo/);
    assert.ok(h.operations.every(op => op.mode === "read"));
    h.control.fetch = async () => new Response("private-provider-response", { status: 200 });
    const malformed = await h.server.checkOutlookConnection();
    assert.equal(malformed.status, "failed"); assert.doesNotMatch(malformed.problem, /private-provider-response/);
  })],
  ["an attachment page failure retains new pending work and retries all metadata before one closure", practice(async h => {
    const message = graphMessage("attachment-retry", "We will not be proceeding.", { hasAttachments: true });
    let fail = true;
    h.control.fetch = async url => url.includes("skiptoken=2")
      ? fail ? jsonResponse({}, 503) : jsonResponse({ value: [{ id: "a2", name: "second.pdf" }] })
      : jsonResponse({ value: [{ id: "a1", name: "first.jpg" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/shared%40example.test/messages/attachment-retry/attachments?$skiptoken=2" });
    const first = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, first, COMPLETE_WINDOW);
    assert.equal(first.errors, 1); await expectPending(h);
    assert.deepEqual((await row(h, "outlook_message_work")).attachment_refs, []);
    fail = false;
    const second = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, second, COMPLETE_WINDOW);
    assert.equal(second.errors, 0); assert.equal(second.stored, 1); assert.equal(second.closed, 1);
    assert.deepEqual((await row(h, "job_communications")).attachment_refs.map((a: any) => a.id), ["a1", "a2"]);
    assert.equal((await row(h, "outlook_message_work")).status, "complete");
    assert.equal(await total(h, "workflow_events"), 1);
    const replay = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, replay, COMPLETE_WINDOW);
    assert.equal(replay.duplicate, 1); assert.equal(await total(h, "workflow_events"), 1);
    assert.ok(h.requests.every(r => r.url.startsWith("https://connector-gateway.lovable.dev/microsoft_outlook/users/shared%40example.test/")));
  })],
  ...(["job read error", "later inbound count error", "later inbound count absent"] as const).map((kind): [string, () => Promise<void>] =>
    [`${kind} fails closed and leaves retryable new processing`, practice(async h => {
      const message = graphMessage(`unreadable-${kind}`, "Please cancel my enquiry.");
      h.control.fault = op => kind === "job read error" && op.table === "jobs" && op.fields === "stage"
        ? { data: null, error: { message: "injected job read failure" } }
        : kind !== "job read error" && op.table === "job_communications" && op.head
          ? { data: null, error: kind === "later inbound count error" ? { message: "injected history read failure" } : null, count: null }
          : null;
      const first = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, first, COMPLETE_WINDOW);
      assert.equal(first.errors, 1); await expectPending(h);
      h.control.fault = null;
      const retry = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, retry, COMPLETE_WINDOW);
      assert.equal(retry.closed, 1); assert.equal(await total(h, "workflow_events"), 1);
    })]),
  ["audit failure rolls back correspondence and closure; the pending queue retries without provider replay", practice(async h => {
    await configured(h);
    await h.db.exec(`CREATE FUNCTION reject_outlook_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
      CREATE TRIGGER fail_audit BEFORE INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION reject_outlook_audit();`);
    const first = h.counts(); await h.server.processMessages([graphMessage("audit-retry", "Please cancel my enquiry.")], TEST_MAILBOX, first, COMPLETE_WINDOW);
    assert.equal(first.errors, 1); await expectPending(h); assert.equal(await total(h, "workflow_events"), 0);
    await h.db.exec(`DROP TRIGGER fail_audit ON workflow_events`);
    await h.db.exec(`UPDATE outlook_sync_state SET all_inbound_cursor='2026-10-20T08:30:00Z'`);
    h.control.fetch = async url => readOnlyResponses(url);
    const retry = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(retry.ok, true, retry.blocker); assert.equal(retry.counts.closed, 1);
    assert.equal(await total(h, "job_communications"), 1); assert.equal(await total(h, "workflow_events"), 1);
    const replay = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(replay.ok, true, replay.blocker); assert.equal(await total(h, "workflow_events"), 1);
  })],
  ["review insertion failure is atomic and retry creates one correspondence/review pair", practice(async h => {
    await h.db.exec(`CREATE FUNCTION reject_outlook_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected review failure'; END $$;
      CREATE TRIGGER fail_review BEFORE INSERT ON correspondence_reviews FOR EACH ROW EXECUTE FUNCTION reject_outlook_review();`);
    const message = graphMessage("review-retry", "We might not proceed if the price stays high.");
    const first = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, first, COMPLETE_WINDOW);
    assert.equal(first.errors, 1); await expectPending(h);
    await h.db.exec(`DROP TRIGGER fail_review ON correspondence_reviews`);
    const retry = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, retry, COMPLETE_WINDOW);
    assert.equal(retry.flagged, 1); assert.equal(retry.closed, 0);
    assert.equal(await total(h, "job_communications"), 1); assert.equal(await total(h, "correspondence_reviews"), 1);
  })],
  ["legacy communications/reviews never become pending and are never retrospectively closed", practice(async h => {
    await h.db.query(`INSERT INTO job_communications(job_id,direction,channel,provider,provider_message_id,body) VALUES($1,'inbound','email','outlook','legacy-comm','original historical text')`, [TEST_JOB]);
    await h.db.exec(`INSERT INTO correspondence_reviews(kind,provider_message_id,direction,reason) VALUES('unmatched','legacy-review','inbound','Historical review')`);
    const result = h.counts();
    await h.server.processMessages([graphMessage("legacy-comm", "Please cancel my enquiry."), graphMessage("legacy-review", "Please cancel my enquiry.")], TEST_MAILBOX, result, COMPLETE_WINDOW);
    assert.equal(result.duplicate, 2); assert.equal(await total(h, "outlook_message_work"), 0);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry");
    assert.equal((await row(h, "job_communications")).body, "original historical text");
    assert.equal(await total(h, "workflow_events"), 0);
    await h.db.exec(migration()); assert.equal(await total(h, "outlook_message_work"), 0);
  })],
  ["a later inbound message reserved on the page blocks earlier cancellation", practice(async h => {
    const counts = h.counts();
    await h.server.processMessages([
      graphMessage("older-decline", "Please cancel my enquiry."),
      graphMessage("later-reply", "Actually please continue.", { receivedDateTime: "2026-10-20T09:00:00Z" }),
    ], TEST_MAILBOX, counts, COMPLETE_WINDOW);
    assert.equal(counts.errors, 0); assert.equal(counts.closed, 0); assert.equal(counts.flagged, 1);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry"); assert.equal(await total(h, "job_communications"), 2);
  })],
  ["a bounded cursor preserves the provider continuation across equal-timestamp pages", practice(async h => {
    await configured(h);
    h.control.fetch = async url => {
      if (url.includes("/me?") || url.includes("$select=id,body")) return readOnlyResponses(url);
      if (url.includes("/attachments")) return jsonResponse({ value: [] });
      if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
      if (url.includes("$skiptoken=next")) return jsonResponse({ value: [graphMessage("equal-c")] });
      return jsonResponse({ value: [graphMessage("equal-a"), graphMessage("equal-b")], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/shared%40example.test/messages?$skiptoken=next" });
    };
    const first = await h.server.runOutlookSync({ maxPages: 1, pageSize: 2 });
    assert.equal(first.ok, true, first.blocker); assert.equal(first.counts.stored, 2);
    assert.match((await h.state()).all_inbound_next_link, /skiptoken=next/);
    const second = await h.server.runOutlookSync({ maxPages: 1, pageSize: 2 });
    assert.equal(second.ok, true, second.blocker); assert.equal(second.counts.stored, 1);
    assert.equal(await total(h, "job_communications"), 3); assert.equal((await h.state()).all_inbound_next_link, null);
    assert.ok(h.requests.some(r => r.url.includes("$skiptoken=next")));
    assert.ok(h.requests.every(r => !r.url.includes("/me/mailFolders/") && !r.url.includes("/me/messages/")));
  })],
  ["unsafe provider next links block before page side effects and are never fetched", practice(async h => {
    await configured(h);
    h.control.fetch = async url => url.includes("/attachments") ? jsonResponse({ value: [] }) : url.includes("/me?") || url.includes("$select=id,body") ? readOnlyResponses(url)
      : jsonResponse({ value: [graphMessage("unsafe-page", "Please cancel my enquiry.")], "@odata.nextLink": "https://evil.example/steal" });
    const result = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(result.ok, false); assert.equal(await total(h, "outlook_message_work"), 0);
    assert.equal((await h.state()).all_inbound_cursor, null);
    assert.ok(h.requests.every(r => new URL(r.url).origin === "https://connector-gateway.lovable.dev"));
  })],
  ["an early-page decline followed by a future-page inbound reply creates review without closure", practice(async h => {
    await configured(h);
    h.control.fetch = async url => {
      if (url.includes("/me?") || url.includes("$select=id,body")) return readOnlyResponses(url);
      if (url.includes("/attachments")) return jsonResponse({ value: [] });
      if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
      if (url.includes("$skiptoken=later")) return jsonResponse({ value: [graphMessage("future-page-reply", "Actually, please continue.", { receivedDateTime: "2026-10-20T09:00:00Z" })] });
      return jsonResponse({ value: [graphMessage("early-page-decline", "Please cancel my enquiry.")],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/shared%40example.test/messages?$skiptoken=later" });
    };
    const result = await h.server.runOutlookSync({ maxPages: 2, pageSize: 1 });
    assert.equal(result.ok, true, result.blocker); assert.equal(result.counts.closed, 0); assert.equal(result.counts.flagged, 1);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry"); assert.equal(await total(h, "job_communications"), 2);
    assert.match((await row(h, "correspondence_reviews")).reason, /later Inbox correspondence has not been fully checked/);
    assert.equal(await total(h, "workflow_events"), 0);
  })],
  ["a complete fresh Inbox window retains explicit-decline closure and records its fixed cutoff", practice(async h => {
    await configured(h);
    h.control.fetch = async url => url.includes("/attachments") ? jsonResponse({ value: [] }) : url.includes("/me?") || url.includes("$select=id,body") ? readOnlyResponses(url)
      : jsonResponse({ value: filterField(url) === "receivedDateTime" ? [graphMessage("complete-window-decline", "Please cancel my enquiry.")] : [] });
    const result = await h.server.runOutlookSync({ maxPages: 2 });
    assert.equal(result.ok, true, result.blocker); assert.equal(result.counts.closed, 1);
    const event = await row(h, "workflow_events");
    assert.ok(event.details.inbox_complete_through);
    const pages = h.requests.filter(r => new URL(r.url).searchParams.get("$filter")?.includes(" le "));
    assert.equal(pages.length, 2);
    for (const page of pages) assert.ok(new URL(page.url).searchParams.get("$filter")!.endsWith(` le ${event.details.inbox_complete_through}`));
    assert.ok(pages[0]!.url.includes("receivedDateTime")); assert.ok(pages[1]!.url.includes("sentDateTime"));
  })],
  ["an older continuation cannot prove current completeness; subsequent fresh scans preserve its review", practice(async h => {
    await configured(h);
    await h.db.exec(`UPDATE outlook_sync_state SET all_inbound_next_link='https://graph.microsoft.com/v1.0/users/shared%40example.test/messages?$skiptoken=older-cutoff'`);
    h.control.fetch = async url => {
      if (url.includes("/me?") || url.includes("$select=id,body")) return readOnlyResponses(url);
      if (url.includes("/attachments")) return jsonResponse({ value: [] });
      if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
      return jsonResponse({ value: url.includes("older-cutoff")
        ? [graphMessage("old-window-decline", "Please cancel my enquiry.")]
        : [graphMessage("new-window-reply", "Please continue after all.", { receivedDateTime: "2026-10-20T09:00:00Z" })] });
    };
    const older = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(older.ok, true, older.blocker); assert.equal(older.counts.closed, 0); assert.equal(older.counts.flagged, 1);
    assert.equal((await h.state()).all_inbound_next_link, null);
    const fresh = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(fresh.ok, true, fresh.blocker); assert.equal(fresh.counts.closed, 0);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry");
    assert.equal(await total(h, "correspondence_reviews"), 1); assert.equal(await total(h, "workflow_events"), 0);
  })],
  ["Inbox completion and newer correspondence are considered before a closure-capable Sent Items record", practice(async h => {
    await configured(h);
    h.control.fetch = async url => url.includes("/attachments") ? jsonResponse({ value: [] }) : url.includes("/me?") || url.includes("$select=id,body") ? readOnlyResponses(url)
      : jsonResponse({ value: filterField(url) === "receivedDateTime"
        ? [graphMessage("new-inbox-reply", "Please continue.", { receivedDateTime: "2026-10-20T09:00:00Z" })]
        : [graphMessage("older-sent-folder-record", "Please cancel my enquiry.")] });
    const result = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(result.ok, true, result.blocker); assert.equal(result.counts.closed, 0); assert.equal(result.counts.flagged, 1);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry"); assert.equal(await total(h, "workflow_events"), 0);
  })],
  ["failed cursor/status writes do not report success or repeat completed closure/audit", practice(async h => {
    await configured(h);
    h.control.fetch = async url => url.includes("/attachments") ? jsonResponse({ value: [] }) : url.includes("/me?") || url.includes("$select=id,body") ? readOnlyResponses(url)
      : jsonResponse({ value: filterField(url) === "receivedDateTime" ? [graphMessage("cursor-failure", "Please cancel my enquiry.")] : [] });
    h.control.fault = op => op.table === "outlook_sync_state" && op.mode === "update" ? { data: null, error: { message: "injected state write failure" } } : null;
    const first = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(first.ok, false); assert.match(first.blocker, /state was not saved/);
    assert.equal((await h.state()).all_inbound_cursor, null); assert.equal(await total(h, "workflow_events"), 1);
    h.control.fault = null;
    const retry = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(retry.ok, true, retry.blocker); assert.equal(retry.counts.closed, 0);
    assert.equal(await total(h, "job_communications"), 1); assert.equal(await total(h, "workflow_events"), 1);
  })],
  ["SQL rejects stale closure decisions, completed-work mutation, unsafe mailbox switches, and public execution", practice(async h => {
    const message = { providerMessageId: "sql-guard", direction: "inbound", from: "owner@example.test", to: [TEST_MAILBOX], cc: [], body: "Please cancel my enquiry.", at: "2026-10-20T08:00:00Z", hasAttachments: false };
    const route = { kind: "job", jobId: TEST_JOB, how: "job_number" };
    await h.db.query(`SELECT begin_outlook_message($1,$2,$3)`, [TEST_MAILBOX, JSON.stringify(message), JSON.stringify(route)]);
    await h.db.exec(`UPDATE outlook_message_work SET attachments_complete=true`);
    await h.db.exec(`UPDATE jobs SET stage='installation_booked'`);
    await assert.rejects(h.db.query(`SELECT finish_outlook_message('sql-guard',$1)`, [JSON.stringify({ action: "close", expectedStage: "new_enquiry", reason: "Customer not proceeding" })]), /Job changed/);
    assert.equal(await total(h, "job_communications"), 0);
    await h.db.query(`SELECT finish_outlook_message('sql-guard',$1)`, [JSON.stringify({ action: "none" })]);
    await assert.rejects(h.db.exec(`UPDATE outlook_message_work SET message='{}'`), /immutable/);
    await assert.rejects(h.db.exec(`DELETE FROM outlook_message_work`), /permanent/);
    await h.db.query(`SELECT confirm_outlook_mailbox($1,$2)`, [TEST_MAILBOX, TEST_ACTOR]);
    await assert.rejects(h.db.query(`SELECT confirm_outlook_mailbox('other@example.test',$1)`, [TEST_ACTOR]), /reviewed migration/);
    const grants = (await h.db.query<{ allowed: boolean }>(`SELECT has_function_privilege('authenticated','public.finish_outlook_message(text,jsonb)','EXECUTE') AS allowed`)).rows[0]!;
    assert.equal(grants.allowed, false);
    assert.equal((await h.db.query<{ allowed: boolean }>(`SELECT has_table_privilege('anon','outlook_message_work','SELECT') AS allowed`)).rows[0]!.allowed, false);
  })],
  ["an inline-image-only email still stores its attached file privately", practice(async h => {
    const message = graphMessage("inline-only", "Please see the photo.", { hasAttachments: false });
    h.control.fetch = async url => {
      if (url.includes("/attachments/inline-1/$value")) return bytesResponse(new Uint8Array([1, 2, 3, 4]), "image/jpeg");
      if (url.includes("/attachments")) return jsonResponse({ value: [{ id: "inline-1", name: "photo.jpg", contentType: "image/jpeg", size: 4, isInline: true }] });
      return jsonResponse({ value: [] });
    };
    const result = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, result, COMPLETE_WINDOW);
    assert.equal(result.errors, 0); assert.equal(result.stored, 1); assert.equal(result.files, 1);
    const refs = (await row(h, "job_communications")).attachment_refs;
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, `correspondence/${TEST_JOB}/${attachmentIdentityKey(TEST_MAILBOX, "inline-only", "inline-1")}/1-photo.jpg`);
    assert.equal(refs[0].skipped, null);
    assert.equal(h.files.get(refs[0].path).length, 4);
  })],
  ["mail moved between folders is re-listed but never re-stored", practice(async h => {
    await configured(h);
    h.control.fetch = async url => {
      if (url.includes("/attachments")) return jsonResponse({ value: [] });
      if (url.includes("/me?") || url.includes("$select=id,body")) return readOnlyResponses(url);
      if (filterField(url) === "receivedDateTime") return jsonResponse({ value: [graphMessage("moved-mail")] });
      return jsonResponse({ value: [] });
    };
    const first = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(first.ok, true, first.blocker); assert.equal(first.counts.stored, 1);
    // The same immutable message re-appears in the folder-agnostic stream (e.g. after an Archive move).
    const second = await h.server.runOutlookSync({ maxPages: 1 });
    assert.equal(second.ok, true, second.blocker); assert.equal(second.counts.duplicate, 1); assert.equal(second.counts.stored, 0);
    assert.equal(await total(h, "job_communications"), 1);
    const messagePages = h.requests.filter(r => r.url.includes("/messages?$select="));
    assert.ok(messagePages.length >= 2);
    assert.ok(messagePages.every(r => !r.url.includes("/mailFolders/")));
  })],
  ["one message concerning two properties links to both jobs and never duplicates", practice(async h => {
    await h.db.exec(`INSERT INTO jobs(id,job_number,owner_id,property_id) VALUES('55555555-5555-4555-8555-555555555555','HV-1002','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444')`);
    const message = graphMessage("two-jobs", "Both homes please", { subject: "HV-1001 and HV-1002" });
    const result = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, result, COMPLETE_WINDOW);
    assert.equal(result.errors, 0); assert.equal(result.stored, 1); assert.equal(result.closed, 0); assert.equal(result.flagged, 0);
    assert.equal(await total(h, "job_communications"), 2);
    assert.equal(await total(h, "outlook_message_work"), 1);
    assert.equal(await total(h, "workflow_events"), 0);
    const replay = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, replay, COMPLETE_WINDOW);
    assert.equal(replay.duplicate, 1); assert.equal(await total(h, "job_communications"), 2);
    await assert.rejects(h.db.exec(rollback()), /preserve its queue/);
  })],
  ["a family reply in a known thread links to the job (staff-visible); an unknown sender is preserved in Office review", practice(async h => {
    await h.db.query(`INSERT INTO job_communications(job_id,direction,channel,provider,provider_message_id,provider_thread_id,body) VALUES($1,'outbound','email','outlook','orig-msg','thread-1','original')`, [TEST_JOB]);
    const reply = graphMessage("family-reply", "Grandma here — all good thanks", { conversationId: "thread-1", subject: "Re: insulation", from: { emailAddress: { address: "family@example.test" } } });
    const stranger = graphMessage("stranger", "Buy now", { subject: "Deal", from: { emailAddress: { address: "news@vendor.example" } } });
    const result = h.counts(); await h.server.processMessages([reply, stranger], TEST_MAILBOX, result, COMPLETE_WINDOW);
    assert.equal(result.errors, 0); assert.equal(result.stored, 1); assert.equal(result.unmatched, 1); assert.equal(result.notHomeowner, 0);
    const stored = await h.db.query<{ job_id: string; source_event: string; visibility: string }>(`SELECT job_id, source_event, visibility FROM job_communications WHERE provider_message_id='family-reply'`);
    assert.equal(stored.rows.length, 1); assert.equal(stored.rows[0]!.job_id, TEST_JOB);
    assert.equal(stored.rows[0]!.source_event, "outlook_sync:thread");
    // The family address is not the confirmed owner, so this mail is staff-visible, never on the owner view.
    assert.equal(stored.rows[0]!.visibility, "internal");
    const review = await h.db.query<{ reason: string }>(`SELECT reason FROM correspondence_reviews WHERE provider_message_id='stranger'`);
    assert.equal(review.rows.length, 1);
    assert.match(review.rows[0]!.reason, /review and assign or dismiss/);
  })],
  ["a family reply in the same batch as its first matched thread message is retained", practice(async h => {
    const first = graphMessage("first-thread-msg", "Hi, about our insulation", { conversationId: "new-thread", subject: "Insulation" });
    const reply = graphMessage("same-batch-reply", "Grandma again — sounds good", { conversationId: "new-thread", subject: "Re: Insulation", from: { emailAddress: { address: "family@example.test" } } });
    const result = h.counts(); await h.server.processMessages([first, reply], TEST_MAILBOX, result, COMPLETE_WINDOW);
    assert.equal(result.errors, 0); assert.equal(result.stored, 2); assert.equal(result.unmatched, 0);
    const rows = await h.db.query<{ job_id: string }>(`SELECT job_id FROM job_communications WHERE provider_message_id='same-batch-reply'`);
    assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0]!.job_id, TEST_JOB);
  })],
  ["a mutable old id aliasing a stored internetMessageId is a duplicate; distinct emails are never merged", practice(async h => {
    await h.db.query(`INSERT INTO job_communications(job_id,direction,channel,provider,provider_message_id,provider_thread_id,body,source_reference) VALUES($1,'inbound','email','outlook','old-mutable-id','thread-9','original body','<immutable@example>')`, [TEST_JOB]);
    const renamed = graphMessage("new-mutable-id", "original body", { internetMessageId: "<immutable@example>" });
    const distinct = graphMessage("other-id", "different body", { internetMessageId: "<other@example>" });
    const result = h.counts(); await h.server.processMessages([renamed, distinct], TEST_MAILBOX, result, COMPLETE_WINDOW);
    assert.equal(result.errors, 0); assert.equal(result.duplicate, 1); assert.equal(result.stored, 1);
    const rows = await h.db.query<{ provider_message_id: string }>(`SELECT provider_message_id FROM job_communications WHERE job_id=$1 ORDER BY provider_message_id`, [TEST_JOB]);
    assert.deepEqual(rows.rows.map(r => r.provider_message_id), ["old-mutable-id", "other-id"]);
  })],
  ["historical catch-up work is record-only on the work row and stays record-only on retry", practice(async h => {
    const message = graphMessage("hist-decline", "Please cancel my enquiry.", { receivedDateTime: "2026-10-05T08:00:00Z" });
    h.control.fetch = async () => jsonResponse({ value: [] });
    // Fail the first completion once so the message stays pending, as after a crash mid-processing.
    let failOnce = true;
    h.control.fault = op => {
      if (failOnce && op.table === "outlook_message_work" && op.mode === "update") { failOnce = false; return { data: null, error: { message: "injected finish failure" } }; }
      return null;
    };
    const first = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, first, { inboxCompleteThrough: null, history: true, backfillFrom: "2026-10-10T00:00:00Z" });
    assert.equal(first.errors, 1);
    const work = await row(h, "outlook_message_work");
    assert.equal(work.status, "pending"); assert.equal(work.record_only, true);
    // A later retry that no longer carries the history window must still honour the persisted flag.
    h.control.fault = null;
    const retry = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, retry, COMPLETE_WINDOW);
    assert.equal(retry.errors, 0); assert.equal(retry.closed, 0);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry");
    assert.equal(await total(h, "workflow_events"), 0);
    assert.equal(await total(h, "job_communications"), 1);
  })],
  ["SQL refuses stage decisions on record-only historical work", practice(async h => {
    const message = { providerMessageId: "hist-sql", direction: "inbound", from: "owner@example.test", to: [TEST_MAILBOX], cc: [], body: "Please cancel my enquiry.", at: "2026-10-05T08:00:00Z", hasAttachments: false };
    const route = { kind: "job", jobIds: [TEST_JOB], how: "job_number" };
    await h.db.query(`SELECT begin_outlook_message($1,$2,$3,$4)`, [TEST_MAILBOX, JSON.stringify(message), JSON.stringify(route), true]);
    await h.db.exec(`UPDATE outlook_message_work SET attachments_complete=true`);
    await assert.rejects(h.db.query(`SELECT finish_outlook_message('hist-sql',$1)`, [JSON.stringify({ action: "close", expectedStage: "new_enquiry", reason: "Customer not proceeding", inboxCompleteThrough: "2026-10-20T10:00:00Z" })]), /record-only/);
    await assert.rejects(h.db.query(`SELECT finish_outlook_message('hist-sql',$1)`, [JSON.stringify({ action: "flag", kind: "possible_not_proceeding", reason: "check" })]), /record-only/);
    await h.db.query(`SELECT finish_outlook_message('hist-sql',$1)`, [JSON.stringify({ action: "none" })]);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry");
    assert.equal(await total(h, "job_communications"), 1);
  })],
  ["attachment ids that look alike keep distinct paths; a mismatched existing object is a visible error until corrected", practice(async h => {
    const message = graphMessage("collide-msg", "Two photos", { hasAttachments: true });
    h.control.fetch = async url => {
      if (url.includes("/attachments/one/$value")) return bytesResponse(new Uint8Array([1, 1, 1]), "image/jpeg");
      if (url.includes("/attachments/two/$value")) return bytesResponse(new Uint8Array([2, 2, 2]), "image/jpeg");
      if (url.includes("/attachments")) return jsonResponse({ value: [
        { id: "one", name: "p.jpg", contentType: "image/jpeg", size: 3, isInline: false },
        { id: "two", name: "p.jpg", contentType: "image/jpeg", size: 3, isInline: false },
      ] });
      return jsonResponse({ value: [] });
    };
    const pathOne = `correspondence/${TEST_JOB}/${attachmentIdentityKey(TEST_MAILBOX, "collide-msg", "one")}/1-p.jpg`;
    const pathTwo = `correspondence/${TEST_JOB}/${attachmentIdentityKey(TEST_MAILBOX, "collide-msg", "two")}/2-p.jpg`;
    assert.notEqual(pathOne, pathTwo);
    // A different file already sitting at the first deterministic path must fail the byte check.
    h.files.set(pathOne, new Uint8Array([9, 9, 9]));
    const first = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, first, COMPLETE_WINDOW);
    assert.equal(first.errors, 1);
    assert.equal((await row(h, "outlook_message_work")).status, "pending");
    assert.match((await row(h, "outlook_message_work")).last_error, /not overwritten/);
    // Correcting the stored object lets the retry finish with both verified files at distinct paths.
    h.files.set(pathOne, new Uint8Array([1, 1, 1]));
    const retry = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, retry, COMPLETE_WINDOW);
    assert.equal(retry.errors, 0); assert.equal(retry.files, 2);
    const refs = (await row(h, "job_communications")).attachment_refs;
    assert.deepEqual(refs.map((r: any) => r.path), [pathOne, pathTwo]);
    assert.equal(h.files.get(pathTwo).length, 3);
  })],
  ["metadata-only legacy mail is repaired idempotently without workflow changes", practice(async h => {
    await h.db.query(`INSERT INTO job_communications(job_id,direction,channel,provider,provider_message_id,body,attachment_refs,source_reference) VALUES($1,'inbound','email','outlook','legacy-att','see photo','[{"id":"a1","name":"photo.jpg","contentType":"image/jpeg","size":4,"isInline":false,"path":null,"storedAt":null,"skipped":null}]','<legacy@imm>')`, [TEST_JOB]);
    const message = graphMessage("legacy-att", "see photo", { hasAttachments: true });
    h.control.fetch = async url => {
      if (url.includes("/attachments/a1/$value")) return bytesResponse(new Uint8Array([7, 7, 7, 7]), "image/jpeg");
      if (url.includes("/attachments")) return jsonResponse({ value: [{ id: "a1", name: "photo.jpg", contentType: "image/jpeg", size: 4, isInline: false }] });
      return jsonResponse({ value: [] });
    };
    const result = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, result, COMPLETE_WINDOW);
    assert.equal(result.errors, 0); assert.equal(result.duplicate, 1); assert.equal(result.files, 1);
    const refs = (await row(h, "job_communications")).attachment_refs;
    assert.ok(refs[0].path); assert.equal(h.files.get(refs[0].path).length, 4);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry");
    // Replay: the repair is idempotent — verified bytes are reused, no duplicate correspondence row.
    const replay = h.counts(); await h.server.processMessages([message], TEST_MAILBOX, replay, COMPLETE_WINDOW);
    assert.equal(replay.errors, 0); assert.equal(await total(h, "job_communications"), 1);
  })],
  ["an expired saved continuation is recovered by idempotent replay from the saved cursor", practice(async h => {
    await configured(h);
    await h.db.exec(`UPDATE outlook_sync_state SET all_inbound_next_link='https://graph.microsoft.com/v1.0/users/shared%40example.test/messages?$skiptoken=expired', all_inbound_cursor='2026-10-19T00:00:00Z'`);
    h.control.fetch = async url => {
      if (url.includes("/me?") || url.includes("$select=id,body")) return readOnlyResponses(url);
      if (url.includes("/attachments")) return jsonResponse({ value: [] });
      if (url.includes("skiptoken=expired")) return jsonResponse({ error: "expired" }, 400);
      if (filterField(url) === "sentDateTime") return jsonResponse({ value: [] });
      return jsonResponse({ value: [graphMessage("recovered-msg", "Hello", { receivedDateTime: "2026-10-19T05:00:00Z" })] });
    };
    const result = await h.server.runOutlookSync({ maxPages: 2 });
    assert.equal(result.ok, true, result.blocker);
    assert.equal(result.counts.stored, 1);
    const state = await h.state();
    assert.equal(state.all_inbound_next_link, null);
    assert.ok(new Date(state.all_inbound_cursor).toISOString() >= "2026-10-19T05:00:00Z");
  })],
  ["Office can set and stop an explicit historical catch-up start; no silent cutoff", practice(async h => {
    await h.server.setCatchupFrom("2025-01-01T00:00:00Z");
    assert.ok(new Date((await h.state()).catchup_from).toISOString().startsWith("2025-01-01"));
    await assert.rejects(h.server.setCatchupFrom("2027-01-01T00:00:00Z"), /future/);
    await assert.rejects(h.server.setCatchupFrom("not-a-date"), /valid catch-up start date/);
    await h.server.setCatchupFrom(null);
    assert.equal((await h.state()).catchup_from, null);
  })],
  ["historical catch-up stores old mail without changing any job and clears itself", practice(async h => {
    await configured(h);
    await h.db.exec(`UPDATE outlook_sync_state SET catchup_from='2026-10-01T00:00:00Z', backfill_from='2026-10-10T00:00:00Z'`);
    h.control.fetch = async url => {
      if (url.includes("/attachments")) return jsonResponse({ value: [] });
      if (url.includes("/me?") || url.includes("$select=id,body")) return readOnlyResponses(url);
      if (filterField(url) === "receivedDateTime") return jsonResponse({ value: [graphMessage("old-decline", "Please cancel my enquiry.", { receivedDateTime: "2026-10-05T08:00:00Z" })] });
      return jsonResponse({ value: [] });
    };
    const result = await h.server.runOutlookSync({ maxPages: 2 });
    assert.equal(result.ok, true, result.blocker);
    assert.equal(result.counts.stored, 1); assert.equal(result.counts.closed, 0); assert.equal(result.counts.flagged, 0);
    assert.equal((await row(h, "jobs")).stage, "new_enquiry");
    assert.equal(await total(h, "job_communications"), 1); assert.equal(await total(h, "workflow_events"), 0);
    assert.equal((await h.state()).catchup_from, null);
    assert.equal((await h.state()).catchup_inbound_cursor, null);
  })],
];
