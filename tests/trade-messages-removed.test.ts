// Part 7 Task 8 (Jo 2 Nov 2026): the replaced trade messages are gone — the "Add your usual electrician" text (decision
// 374: we always choose the electrician on our leads; decision 303 handles A1), the 2pm "Pick the crew for tomorrow" crew
// reminder (#110) and the in-house 2pm "Tomorrow’s installs — Lead Installer" office email — all replaced by the 9am
// two-days-before "Confirm or change your Lead Installer by 5pm today" email (Task 6). Nothing retired may be referenced
// from src/ or scripts/; an install day that already got the old 2pm email never gets the new one too.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { stableUuid } from "../src/lib/mitti-create-claim.core";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n: string) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const SOURCES = [...walk("src"), ...walk("scripts")];
const grep = (needle: string) => SOURCES.filter((f) => readFileSync(f, "utf8").includes(needle));

describe("the three senders are gone", () => {
  test("files deleted", () => {
    for (const f of ["src/lib/usual-electrician-reminder.server.ts", "src/lib/crew-reminder.core.ts", "src/lib/crew-reminder.server.ts"]) expect({ f, exists: existsSync(f) }).toEqual({ f, exists: false });
  });
  test("no reference in src/ or scripts/ to the removed exports or the old email subject", () => {
    for (const n of ["sweepCrewReminders", "maybeRemindUsualElectrician", "sweepInHouseInstallOfficeEmails", "tomorrowInstallDigest", "Tomorrow’s installs — Lead Installer", "crew-reminder.core", "crew-reminder.server", "usual-electrician-reminder", "usualElectricianReminderBody("]) {
      expect({ n, in: grep(n) }).toEqual({ n, in: [] });
    }
  });
  test("the allocation tick calls the Lead Installer confirm sweep and none of the removed sweeps", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepLeadInstallerConfirm()");
    for (const n of ["sweepCrewReminders", "sweepInHouseInstallOfficeEmails", "crew-reminder"]) expect(tick).not.toContain(n);
  });
  test("the usual-electrician text type is kept for history only: not approved, never sent, no Needs me row raised", () => {
    expect(SMS_MESSAGE_TYPES.usual_electrician_missing.wordingApproved).toBe(false);
    expect(SMS_MESSAGE_TYPES.usual_electrician_missing.label).toMatch(/^Retired 2 Nov 2026/);
    expect(grep('type: "usual_electrician_missing"')).toEqual([]);
    const needs = readFileSync("src/lib/needs.server.ts", "utf8");
    expect(needs).not.toContain('needsItem("installer_usual_electrician_missing"');
    const quote = readFileSync("src/lib/installer-quote.server.ts", "utf8");
    expect(quote).not.toContain("maybeRemindUsualElectrician");
  });
  test("workflow-decisions lists the three retired messages; the Templates page no longer shows them", () => {
    const retired = (WORKFLOW_DECISIONS as unknown as { tradeMessages: { retired: string[] } }).tradeMessages.retired;
    for (const p of ["2pm day-before Lead Installer email", "Pick the crew for tomorrow", "We need your usual electrician"]) expect(retired).toContain(p);
    const hub = readFileSync("src/lib/template-hub.core.ts", "utf8");
    for (const n of ["Add your usual electrician (text)", "crewReminderEmail", "Pick the crew for tomorrow", "sms-usual_electrician_missing"]) expect(hub).not.toContain(n);
  });
});

// ── the new email never doubles up with the old 2pm one ──────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" = "select";
  let inserted: Row | null = null;
  let range: [number, number] | null = null;
  const res = () => { if (op === "insert") return { data: inserted ? { id: inserted["id"] } : null, error: null }; let rows = (tables[t] ?? []).filter((x) => filters.every((f) => f(x))); if (range) rows = rows.slice(range[0], range[1] + 1); return { data: rows, error: null }; };
  const one = async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    range: (a: number, b: number) => { range = [a, b]; return q; },
    order: () => q, limit: () => q, neq: () => q, not: () => q,
    insert: (r: Row) => { op = "insert"; inserted = { id: crypto.randomUUID(), ...r }; (tables[t] ??= []).push(inserted); return q; },
    maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id, event_type, summary, details, created_at: new Date().toISOString() }); } }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
const office: string[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { subject: string }) => { office.push(p.subject); return { status: "sent", detail: "faked" }; } }));
mock.module("../src/lib/test-send.server", () => ({ TEST_APP_BASE: "https://test.p", sendTestEmail: async () => ({ status: "sent", detail: "test" }) }));
mock.module("../src/lib/set-password-link.core", () => ({ SET_PASSWORD_BASE: "https://p" }));
const { sweepLeadInstallerConfirm } = await import("../src/lib/lead-installer-confirm.server");

const START = "2026-11-12T20:30:00Z"; // Fri 13 Nov 7:30am Melbourne
const WED_0900 = new Date("2026-11-10T22:00:00Z");
beforeEach(() => {
  office.length = 0;
  tables = {
    bookings: [{ id: "BK1", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: START, created_at: "2026-11-09T00:00:00Z" }],
    jobs: [{ id: "J1", job_number: "HV-1234", source: "website", deleted_at: null, owners: { full_name: "Sarah Brown" }, properties: { address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" } }],
    job_assignments: [{ job_id: "J1", role: "installer", active: true, business_id: "B1" }],
    businesses: [{ id: "B1", name: "Rapid Insulation", email: "office@rapid.example", onboarding_notes: null }],
    partner_workers: [{ id: "w1", full_legal_name: "John Smith" }],
    workflow_events: [{ id: "e1", job_id: "J1", event_type: "visit_allocated", created_at: "2026-11-09T01:00:00Z", details: { visit: "install", worker_id: "w1" } }],
    // ecde49a (Part 7): a real office's email is held while customer comms are off — on here, so the sweep reaches the send.
    workflow_settings: [{ id: 1, customer_comms_enabled: true }],
  };
});

describe("sweepLeadInstallerConfirm vs the old 2pm office email", () => {
  test("an install day that already got the old in-house-install-office:v1 email (claim sent) gets no new email", async () => {
    tables["workflow_events"]!.push({ id: await stableUuid("in-house-install-office:v1:B1:2026-11-13"), job_id: "J1", event_type: "in_house_office_email", created_at: "2026-11-12T03:00:00Z", details: { status: "sent", key: "in-house-install-office:v1:B1:2026-11-13" } });
    expect(await sweepLeadInstallerConfirm(WED_0900, { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(office).toEqual([]);
    expect((tables["workflow_events"] ?? []).filter((e) => e["event_type"] === "lead_installer_confirm_email")).toHaveLength(0);
  });
  test("an old claim that never went (not sent) does not block the new email; another day's old claim doesn't either", async () => {
    tables["workflow_events"]!.push({ id: await stableUuid("in-house-install-office:v1:B1:2026-11-13"), job_id: "J1", event_type: "in_house_office_email", created_at: "2026-11-12T03:00:00Z", details: { status: "failed", key: "in-house-install-office:v1:B1:2026-11-13" } });
    tables["workflow_events"]!.push({ id: await stableUuid("in-house-install-office:v1:B1:2026-11-12"), job_id: "J1", event_type: "in_house_office_email", created_at: "2026-11-11T03:00:00Z", details: { status: "sent", key: "in-house-install-office:v1:B1:2026-11-12" } });
    expect(await sweepLeadInstallerConfirm(WED_0900, { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(office).toHaveLength(1);
  });
  test("a job with a lead-confirm:v1 key can never reach the old path — it no longer exists", () => {
    expect(grep("sweepInHouseInstallOfficeEmails")).toEqual([]);
    expect(readFileSync("src/lib/lead-installer-confirm.server.ts", "utf8")).toContain("in-house-install-office:v1:");
  });
});
