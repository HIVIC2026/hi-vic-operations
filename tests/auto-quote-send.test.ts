// Jo 24 Oct: Complete in Mitti → quote to the owner when every check passes; otherwise held for the office.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { ACCESS_FEE_MAX, AUTO_QUOTE_SEND_ENABLED, CHANGED_AFTER_SEND, accessFeeHold, autoSendDecision, installerPriceRangeHold } from "../src/lib/auto-quote-send.core";

describe("price checks (Jo: $15–$30/m² insulation, $5–$15/m² removal, access fee ≤ $500)", () => {
  test("inside the range passes", () => expect(installerPriceRangeHold(3000, 120, null)).toBeNull());
  test("removal widens the range", () => {
    expect(installerPriceRangeHold(4200, 120, 120)).toBeNull(); // max 120×30 + 120×15 = 5400
    expect(installerPriceRangeHold(4200, 120, null)).toContain("above the normal range"); // max 3600 without removal
  });
  test("too cheap and too dear are held with the numbers", () => {
    expect(installerPriceRangeHold(1500, 120, null)).toBe("Quote held: installer price $1,500 is below the normal range ($1,800–$3,600 for 120 m²)");
    expect(installerPriceRangeHold(6000, 120, 100)).toBe("Quote held: installer price $6,000 is above the normal range ($2,300–$5,100 for 120 m² + 100 m² removal)");
  });
  test("missing price or area can't be checked", () => expect(installerPriceRangeHold(null, 120, null)).toContain("can't be checked"));
  test("access fee", () => {
    expect(ACCESS_FEE_MAX).toBe(500);
    expect(accessFeeHold({ amountIncGst: 500, reason: null })).toBeNull();
    expect(accessFeeHold({ amountIncGst: 650, reason: null })).toBe("Quote held: difficult access fee $650 is over the $500 limit");
    expect(accessFeeHold({ amountIncGst: null, reason: "Office needs to: confirm the difficult access fee – the amount is missing or not a number" })).toContain("amount is missing");
  });
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
  expect(sync).toContain('if (readyCheckVariant(job.channel) === "ready_check_priced") {');
  expect(sync).toContain("maybeAutoSendInstallerQuote(jobId, { formCompleted: plan.completed");
  const src = readFileSync("src/lib/auto-quote-send.server.ts", "utf8");
  expect(src).not.toMatch(/resendSend|sendRealSms|sendTestEmail|notifyOwnerQuoteReady/);
  expect(src).toContain('releaseQuoteToOwner(jobId, draft.id, null, "auto")');
});

// Jo 24 Oct: Deep's total INCLUDES the access fee — never added twice; only the price check takes it out.
test("access fee is inside the installer total: shown on the line, removed only for the per-m² check", async () => {
  const { applyMittiAccessFeeIncluded } = await import("../src/lib/mitti-installer-quote.core");
  const d = { lines: [{ code: "INSTALLER_PRICE", description: "R5.0 batts – 120 m²" }] };
  applyMittiAccessFeeIncluded(d, true, 300);
  expect(d.lines[0]!.description).toBe("R5.0 batts – 120 m² · Includes difficult access ($300)");
  expect(installerPriceRangeHold(3900 - 300, 120, null)).toBeNull(); // $3,900 incl. $300 access → $3,600 = top of range
  const src = readFileSync("src/lib/installer-quote.server.ts", "utf8");
  expect(src).toContain("installerPrice - (accessFee.amountIncGst ?? 0)");
  expect(src).not.toContain("ACCESS_FEE");
});
