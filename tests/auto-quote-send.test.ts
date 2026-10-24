// Jo 24 Oct: Complete in Mitti → quote to the owner when every check passes; otherwise held for the office.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { AUTO_QUOTE_SEND_ENABLED, CHANGED_AFTER_SEND, autoSendDecision } from "../src/lib/auto-quote-send.core";

// Jo 24 Oct (later): the installer's own jobs have no price-range or access-fee limit.
test("installer jobs: no price or access-fee limit; only a missing access amount holds", () => {
  const src = readFileSync("src/lib/installer-quote.server.ts", "utf8");
  expect(src).toContain("const rangeReason = !intakePrice ? accessFee.reason ?? null : null;");
  expect(src).not.toMatch(/installerPriceRange|ACCESS_FEE/);
});

describe("autoSendDecision", () => {
  const base = { enabled: true, formCompleted: true, quoteReady: true, blockers: [] as string[], sentBefore: false };
  test("complete + clean = send", () => expect(autoSendDecision(base)).toEqual({ send: true }));
  test("not complete yet = quietly wait", () => expect(autoSendDecision({ ...base, formCompleted: false })).toMatchObject({ send: false, quiet: true }));
  test("switch off = quietly wait", () => expect(autoSendDecision({ ...base, enabled: false })).toMatchObject({ send: false, quiet: true }));
  test("any failed check holds it for the office", () => expect(autoSendDecision({ ...base, blockers: ["No contact consent from the owner"] })).toEqual({ send: false, reasons: ["No contact consent from the owner"] }));
  test("edited after a quote went out = office", () => expect(autoSendDecision({ ...base, sentBefore: true })).toEqual({ send: false, reasons: [CHANGED_AFTER_SEND] }));
  test("switched off until Jo approves the owner email and the TEST run passes", () => expect(AUTO_QUOTE_SEND_ENABLED).toBe(false));
});

// ---- maybeAutoSendInstallerQuote against real rows (PGlite); the guarded release is mocked ----
const db = new PGlite();
await db.exec(`
CREATE TABLE quotes (id uuid primary key, job_id uuid, kind text, status text, sent_at timestamptz, release_state text, release_hold_reason text, created_at timestamptz, option_code text);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);
const J = "00000000-0000-0000-0000-000000000001", Q = "00000000-0000-0000-0000-0000000000q1".replace("q", "a");
await db.query("insert into quotes values ($1,$2,'installation','draft',null,'held','Waiting for office review before sending','2026-10-24T01:00:00Z','INSTALLER_A1')", [Q, J]);
let blockers: string[] = [];
const released: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
mock.module("../src/lib/installer-quote.server", () => ({ INSTALLER_QUOTE_CODE: "INSTALLER_A1" }));
mock.module("../src/lib/office-quote-review.server", () => ({
  officeQuoteBlockers: async () => blockers,
  releaseQuoteToOwner: async (_j: string, q: string, actor: string | null, how: string) => { released.push(`${q}:${actor}:${how}`); await db.query("update quotes set status='issued', sent_at='2026-10-24T02:00:00Z' where id=$1", [q]); },
}));
const { maybeAutoSendInstallerQuote } = await import("../src/lib/auto-quote-send.server");
const held = async () => (await db.query<{ n: number }>("select count(*)::int n from workflow_events where event_type='quote_auto_send_held'")).rows[0]!.n;

describe("maybeAutoSendInstallerQuote", () => {
  test("form not complete: nothing sent, no office note", async () => {
    expect(await maybeAutoSendInstallerQuote(J, { formCompleted: false, formModifiedAt: "2026-10-24T01:00:00Z", enabled: true })).toEqual({ sent: false, reasons: ["Ready Check not marked Complete in Mitti yet"] });
    expect([released.length, await held()]).toEqual([0, 0]);
  });
  test("complete but a check fails: held, one office note even over many syncs", async () => {
    blockers = ["Quote held: installer price $6,000 is above the normal range ($1,800–$3,600 for 120 m²)"];
    for (let i = 0; i < 3; i++) expect((await maybeAutoSendInstallerQuote(J, { formCompleted: true, formModifiedAt: "2026-10-24T01:00:00Z", enabled: true })).sent).toBe(false);
    expect([released.length, await held()]).toEqual([0, 1]);
  });
  test("switch off: nothing sent even when clean", async () => {
    blockers = [];
    expect((await maybeAutoSendInstallerQuote(J, { formCompleted: true, formModifiedAt: "2026-10-24T01:00:00Z" })).sent).toBe(false);
    expect(released).toEqual([]);
  });
  test("complete and clean: sent once through the guarded release, as an automatic send", async () => {
    expect(await maybeAutoSendInstallerQuote(J, { formCompleted: true, formModifiedAt: "2026-10-24T01:00:00Z", enabled: true })).toEqual({ sent: true, reasons: [] });
    expect(await maybeAutoSendInstallerQuote(J, { formCompleted: true, formModifiedAt: "2026-10-24T01:00:00Z", enabled: true })).toEqual({ sent: false, reasons: [] });
    expect(released).toEqual([`${Q}:null:auto`]);
  });
  test("form edited after sending: office told once, sent quote untouched", async () => {
    for (let i = 0; i < 2; i++) await maybeAutoSendInstallerQuote(J, { formCompleted: true, formModifiedAt: "2026-10-24T03:00:00Z", enabled: true });
    const { rows } = await db.query<{ summary: string }>("select summary from workflow_events where event_type='quote_auto_send_held' order by created_at");
    expect(rows.at(-1)!.summary).toContain(CHANGED_AFTER_SEND);
    expect(await held()).toBe(2);
    expect(released).toHaveLength(1);
  });
});

test("wired into the Mitti sync for installer forms only; sends only through the shared guarded release", () => {
  const sync = readFileSync("src/lib/mitti.server.ts", "utf8");
  expect(sync).toContain("finishMittiReadyCheck(jobId, { auditId: measureAudit, completed: plan.completed");
  expect(readFileSync("src/lib/mitti-complete.server.ts", "utf8")).toContain("maybeAutoSendInstallerQuote(jobId, { formCompleted: true");
  const src = readFileSync("src/lib/auto-quote-send.server.ts", "utf8");
  expect(src).not.toMatch(/resendSend|sendRealSms|sendTestEmail|notifyOwnerQuoteReady/);
  expect(src).toContain('releaseQuoteToOwner(jobId, draft.id, null, "auto")');
});

// Jo 24 Oct: Deep's total INCLUDES the access fee — never added twice.
test("access fee is inside the installer total and shown on the line", async () => {
  const { applyMittiAccessFeeIncluded } = await import("../src/lib/mitti-installer-quote.core");
  const d = { lines: [{ code: "INSTALLER_PRICE", description: "R5.0 batts – 120 m²" }] };
  applyMittiAccessFeeIncluded(d, true, 300);
  expect(d.lines[0]!.description).toBe("R5.0 batts – 120 m² · Includes difficult access ($300)");
});
