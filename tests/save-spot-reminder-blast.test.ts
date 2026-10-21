import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { BLAST_KEY, blastClaimId, currentBlastPrice, offeredLink, selectBlast, type BlastRow } from "../src/lib/save-spot-reminder-blast.core";
import { smsBlocker } from "../src/lib/sms.core";

const url = "https://estimate.homeinsulationvictoria.com.au/estimate/owner-token/campaign";
const row = (patch: Partial<BlastRow> = {}): BlastRow => ({ id: "one", job_number: "HV-1", created_at: "2026-10-21T04:08:00Z", source: "base44", owner_name: "Jane Doe", owner_phone: "0491234567", spot_offered: true, spot_saved: false, deleted_at: null, removed: false, stage: "new_enquiry", total: 3728.49, rebate: 1470, link: url, consent: true, ...patch });
const plan = (rows: BlastRow[], opts: string[] = [], jobs: string[] = [], phones: string[] = []) => selectBlast(rows, opts, jobs, phones);

test("offered true and saved not true qualify", () => {
  expect(plan([row({ spot_saved: null })]).recipients).toHaveLength(1);
  expect(plan([row({ spot_offered: false })]).recipients).toHaveLength(0);
  expect(plan([row({ spot_saved: true })]).recipients).toHaveLength(0);
});
test("deleted enquiries excluded", () => expect(plan([row({ deleted_at: "2026-10-21" })]).recipients).toHaveLength(0));
test("removed enquiries excluded", () => expect(plan([row({ removed: true })]).recipients).toHaveLength(0));
test("cancelled enquiries excluded", () => expect(plan([row({ stage: "cancelled" })]).recipients).toHaveLength(0));
for (const name of ["test", "Testy Smith", "Mrs Hahaha", "Contest owner"]) test(`name containing ${name} excluded`, () => expect(plan([row({ owner_name: name })]).recipients).toHaveLength(0));
test("qa_test records excluded", () => expect(plan([row({ source: "qa_test" })]).recipients).toHaveLength(0));
test("0411111111 excluded even in international form", () => expect(plan([row({ owner_phone: "+61411111111" })]).recipients).toHaveLength(0));
test("any opted_out_at phone excluded after normalization", () => expect(plan([row()], ["+61491234567"]).recipients).toHaveLength(0));
test("latest enquiry selected once across +61 and local formats", () => {
  const result = plan([row({ id: "old", created_at: "2026-10-20T04:08:00Z", total: 1 }), row({ owner_phone: "+61491234567" })]);
  expect(result.recipients.map((r) => r.jobId)).toEqual(["one"]);
  expect(result.recipients[0]?.phone).toBe("0491234567");
  expect(result.skipped[0]?.reason).toContain("most recent");
});
test("missing latest estimate must not fall back to older enquiry", () => expect(plan([row({ total: null }), row({ id: "old", created_at: "2026-10-20T04:08:00Z" })]).recipients).toHaveLength(0));
for (const key of ["owner_name", "total", "rebate", "link"] as const) test(`missing ${key} skipped`, () => expect(plan([row({ [key]: null })]).recipients).toHaveLength(0));
test("no contact consent remains blocked", () => expect(plan([row({ consent: false })]).recipients).toHaveLength(0));
test("invalid phone remains blocked", () => expect(plan([row({ owner_phone: "+12025550123" })]).recipients).toHaveLength(0));
test("claimed job never repeated", () => expect(plan([row()], [], ["one"]).recipients).toHaveLength(0));
test("claimed phone never repeated on a newer different job", () => expect(plan([row({ id: "new-job" })], [], [], ["+61491234567"]).recipients).toHaveLength(0));
test("current standard customer price and rebate, not gross/supplier/range", () => {
  expect(currentBlastPrice([{ by_access: { standard: { estimated_customer_total: 3728.4, applied_discount: 1470, pre_discount_total: 5198 }, difficult: { estimated_customer_total: 6000 } } }])).toEqual({ total: 3728.4, rebate: 1470 });
  expect(currentBlastPrice([{ by_access: { standard: { estimated_customer_total: 3728 } } }]).rebate).toBeNull();
});
test("whole customer dollars with commas and first name", () => {
  const r = plan([row({ total: 3728.6 })]).recipients[0];
  expect(r?.firstName).toBe("Jane"); expect(r?.body).toContain("$3,729"); expect(r?.body).toContain("$1,470");
  expect(r?.idempotencyKey).toBe(BLAST_KEY + "one");
});
test("offer URL is literal and matched to the exact existing token", () => {
  expect(offeredLink(`Calculator: ${url.replace("campaign", "calculator")} Save my spot: ${url}`, "owner-token")).toBe(url);
  expect(offeredLink(url, "other-token")).toBeNull();
  expect(offeredLink(url.replace("estimate.homeinsulationvictoria.com.au", "evil.example"), "owner-token")).toBeNull();
});
const gate = { type: "save_spot_reminder", to: "0491234567", commsEnabled: true, typeSwitchOn: false, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, adminSpotReminderBlast: true };
test("only explicit blast type bypasses its own switch", () => {
  expect(smsBlocker(gate)).toBeNull();
  expect(smsBlocker({ ...gate, adminSpotReminderBlast: false })).toContain("switched off");
  expect(smsBlocker({ ...gate, type: "spot_saved" })).toContain("switched off");
});
test("blast does not bypass master switch", () => expect(smsBlocker({ ...gate, commsEnabled: false })).toContain("switched off"));
test("blast does not bypass opt-outs", () => expect(smsBlocker({ ...gate, optedOut: true })).toContain("STOP"));
test("blast does not bypass consent", () => expect(smsBlocker({ ...gate, consent: false })).toContain("consent"));
test("blast does not bypass TEST guard", () => expect(smsBlocker({ ...gate, isTestRecord: true })).toContain("TEST"));
test("existing SMS persistence primary key fences concurrent/sibling phone sends and job key fences changed phones (practice)", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid'; create role authenticated; create role service_role; create function public.has_role(uuid,text) returns boolean language sql as 'select false'; create table public.workflow_settings(id int primary key); insert into public.workflow_settings values(1); create table public.jobs(id uuid primary key); create table public.businesses(id uuid primary key);`);
    await db.exec(readFileSync("docs/pending-migrations/0141_real_sms_sender.sql", "utf8"));
    const id = await blastClaimId("0491234567");
    expect(await blastClaimId("+61491234567")).toBe(id);
    await db.query("insert into sms_messages(id,message_type,idempotency_key,to_number,body,status) values($1,'save_spot_reminder',$2,'+61491234567','body','sending')", [id, BLAST_KEY + "one"]);
    await expect(db.query("insert into sms_messages(id,message_type,idempotency_key,to_number,body,status) values($1,'save_spot_reminder',$2,'+61491234567','body','sending')", [id, BLAST_KEY + "different-job"])).rejects.toThrow();
    await expect(db.query("insert into sms_messages(id,message_type,idempotency_key,to_number,body,status) values($1,'save_spot_reminder',$2,'+61491567890','body','sending')", [await blastClaimId("0491567890"), BLAST_KEY + "one"])).rejects.toThrow();
    expect((await db.query("select count(*)::int n from sms_messages")).rows[0]).toEqual({ n: 1 });
  } finally { await db.close(); }
});