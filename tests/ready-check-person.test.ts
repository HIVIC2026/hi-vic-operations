// G7 (Jo 4 Nov 2026, pack 2 batch 4): Ready Check booked with "Not sure yet" — the 5pm-the-day-before rule, the
// pending/picked state, the DRAFT office email (flag off), the Needs me row, the Next step box line, and the sweep:
// ONE email per booking to the installer office (TEST → test-send; real → held until READY_CHECK_PERSON_EMAIL_APPROVED),
// ONE `ready_check_person_missing` office event, nothing once the person is picked or before 5pm.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  READY_CHECK_PERSON_EMAIL, READY_CHECK_PERSON_EMAIL_APPROVED, READY_CHECK_PERSON_WORDS, personEmailDue, pickPersonDeadline, readyCheckPersonMissingLine,
  readyCheckPersonState, readyCheckWhen, renderReadyCheckPersonEmail,
} from "../src/lib/ready-check-person.core";
import { nextStepBox, NEXT_STEP_WORDS, type NextStepFacts } from "../src/lib/next-step-box.core";

// Thu 12 Nov 2026 9:00am Melbourne (AEDT, +11) = 2026-11-11T22:00:00Z
const START = "2026-11-11T22:00:00.000Z";
const at = (iso: string) => new Date(iso);

describe("the 5pm-the-day-before rule", () => {
  test("deadline = 5pm Melbourne on the day before the visit (AEDT and AEST)", () => {
    expect(pickPersonDeadline(START)).toBe("2026-11-11T06:00:00.000Z"); // Wed 11 Nov 5pm AEDT
    expect(pickPersonDeadline("2026-06-10T00:00:00.000Z")).toBe("2026-06-09T07:00:00.000Z"); // Wed 10 Jun 10am AEST → Tue 9 Jun 5pm AEST
  });
  test("wait before 5pm the day before; send from 5pm until the visit starts; too late after", () => {
    expect(personEmailDue({ startIso: START, now: at("2026-11-11T05:59:00Z") })).toBe("wait");
    expect(personEmailDue({ startIso: START, now: at("2026-11-11T06:00:00Z") })).toBe("send");
    expect(personEmailDue({ startIso: START, now: at("2026-11-11T21:59:00Z") })).toBe("send");
    expect(personEmailDue({ startIso: START, now: at("2026-11-11T22:00:00Z") })).toBe("too_late");
  });
  test("when reads Melbourne", () => { expect(readyCheckWhen(START)).toBe("Thu 12 Nov, 9:00am"); });
});

describe("pending / picked state from the job's events", () => {
  const pend = (bookingId: string, at: string) => ({ event_type: "ready_check_person_pending", details: { booking_id: bookingId }, created_at: at });
  const alloc = (name: string, at: string) => ({ event_type: "visit_allocated", details: { visit: "ready_check", worker_id: "w1", worker_name: name }, created_at: at });
  test("booked with Not sure yet → pending; a later allocation → picked; an older allocation doesn't count; no booking → nothing", () => {
    expect(readyCheckPersonState([pend("b1", "2026-11-01T00:00:00Z")], "b1")).toEqual({ pending: true, name: null });
    expect(readyCheckPersonState([pend("b1", "2026-11-01T00:00:00Z"), alloc("Will Casdorff", "2026-11-02T00:00:00Z")], "b1")).toEqual({ pending: false, name: "Will Casdorff" });
    expect(readyCheckPersonState([alloc("Will Casdorff", "2026-10-30T00:00:00Z"), pend("b1", "2026-11-01T00:00:00Z")], "b1")).toEqual({ pending: true, name: null });
    expect(readyCheckPersonState([pend("b0", "2026-11-01T00:00:00Z"), alloc("Will Casdorff", "2026-10-30T00:00:00Z")], "b1")).toEqual({ pending: false, name: "Will Casdorff" });
    expect(readyCheckPersonState([pend("b1", "2026-11-01T00:00:00Z")], null)).toEqual({ pending: false, name: null });
  });
});

describe("words (Jo's) and the DRAFT email", () => {
  test("Jo's words; the email is DRAFT (flag off), subject as given, three plain lines, no prices, no HIV short form", () => {
    expect(READY_CHECK_PERSON_WORDS.notSureYet).toBe("Not sure yet");
    expect(READY_CHECK_PERSON_WORDS.pickBy).toBe("Pick who's going by 5pm the day before");
    expect(readyCheckPersonMissingLine("1 Journey Street, Frankston 3199")).toBe("Ready Check tomorrow at 1 Journey Street, Frankston 3199 — nobody picked yet");
    expect(READY_CHECK_PERSON_EMAIL_APPROVED).toBe(false);
    const m = renderReadyCheckPersonEmail({ jobNumber: "HV-3300", address: "1 Journey Street, Frankston 3199", startIso: START, jobUrl: "https://p/field/J1" });
    expect(m.subject).toBe("HV-3300: who's doing the Ready Check tomorrow?");
    expect(m.subject).toBe(READY_CHECK_PERSON_EMAIL.subject("HV-3300"));
    expect(m.text).toContain("The Ready Check at 1 Journey Street, Frankston 3199 is booked for Thu 12 Nov, 9:00am, and nobody's been picked to go yet.");
    expect(m.text).toContain("Pick who's going on the job page and we'll set up their Mitti form.");
    expect(m.text).toContain("https://p/field/J1");
    expect(m.text).not.toMatch(/\$\s?\d|\bHIV\b/);
    expect(m.html).toContain("Home Insulation Victoria");
  });
});

describe("Next step box: booked with Not sure yet", () => {
  const facts = (person: string | null | undefined): NextStepFacts => ({
    channel: "installer_sourced", stage: "ready_check_scheduled", ownerFirst: "Helen", ownerName: "Helen Journey", ownerPhone: "0477 511 901", now: at("2026-11-05T00:00:00Z"),
    givenAt: "2026-11-04T00:00:00Z", readyCheck: { start: START, done: false, missing: [], person }, priceEntered: false, quote: "none", acceptedAt: null, whoBooks: "office", electricianName: null,
    piesa: { start: null, outcome: null, upgradesDone: false, certificateIn: false }, access: null, depositPaidAt: null, install: { start: null, lead: null, swmsSigned: 0, swmsTotal: 0 }, installDone: false, pay: null, mittiFormUrl: null,
  });
  test("nobody picked → 'Pick who's going by 5pm the day before', the pick for that start, no Mitti button; picked / unknown → the usual booked box", () => {
    const b = nextStepBox(facts(null));
    expect(b.kind).toBe("ready_check_booked");
    expect(b.sub).toBe(READY_CHECK_PERSON_WORDS.pickBy);
    expect(b.pickPerson).toEqual({ start: START });
    expect(b.button).toBeNull();
    expect(b.lines).toEqual(["Ready Check · Thu 12 Nov, 9:00am", READY_CHECK_PERSON_WORDS.nobodyYet]);
    for (const p of ["Will Casdorff", undefined]) {
      const ok = nextStepBox(facts(p));
      expect(ok.sub).toBe(NEXT_STEP_WORDS.readyCheckBookedSub);
      expect(ok.pickPerson).toBeNull();
      expect(ok.button).toBe(NEXT_STEP_WORDS.mittiButton);
    }
  });
});

// ── the sweep, in-memory PostgREST ─────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let range: [number, number] | null = null;
  let lim: number | null = null;
  const res = () => {
    let rows = (tables[t] ?? []).filter((x) => filters.every((f) => f(x)));
    if (order) rows = [...rows].sort((a, b) => String(a[order!.col] ?? "").localeCompare(String(b[order!.col] ?? "")) * (order!.asc ? 1 : -1));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    if (lim != null) rows = rows.slice(0, lim);
    // the jobs read embeds properties
    if (t === "jobs") rows = rows.map((r) => ({ ...r, properties: (tables["properties"] ?? []).find((p) => p["id"] === r["property_id"]) ?? null }));
    return { data: rows, error: null };
  };
  const one = async () => { const r = res(); return { ...r, data: r.data[0] ?? null }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return q; },
    range: (a: number, b: number) => { range = [a, b]; return q; },
    limit: (n: number) => { lim = n; return q; },
    maybeSingle: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id, event_type, summary, details, created_at: new Date().toISOString() }); },
}));
let paused: string | null = null;
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));
const office: { to: string; subject: string; key: string | undefined }[] = [];
let officeResult: { status: string; detail: string } = { status: "sent", detail: "faked" };
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; idempotencyKey?: string }) => { office.push({ to: p.to, subject: p.subject, key: p.idempotencyKey }); return officeResult; } }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true }));
const testMail: { to: string; subject: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ TEST_APP_BASE: "https://test.p", sendTestEmail: async (_c: unknown, to: string, subject: string) => { testMail.push({ to, subject }); return { status: "sent", detail: "test" }; } }));
mock.module("../src/lib/set-password-link.core", () => ({ SET_PASSWORD_BASE: "https://p" }));

const { sweepReadyCheckPerson } = await import("../src/lib/ready-check-person.server");
const events = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);
const J = "job-1", B = "bk-1", BIZ = "biz-1";

describe("sweep: ONE office email + ONE Needs me event per pending booking from 5pm the day before", () => {
  beforeEach(() => {
    tables = {
      bookings: [{ id: B, job_id: J, kind: "ready_check", status: "confirmed", scheduled_start: START }],
      jobs: [{ id: J, job_number: "HV-3300", source: "base44", deleted_at: null, stage: "ready_check_scheduled", property_id: "p1" }],
      properties: [{ id: "p1", address_line: "1 Journey Street", suburb: "Frankston", postcode: "3199" }],
      job_assignments: [{ job_id: J, role: "installer", active: true, business_id: BIZ }],
      businesses: [{ id: BIZ, name: "Journey Insulation", email: "office@journey.example", onboarding_notes: null }],
      workflow_events: [{ id: "e1", job_id: J, event_type: "ready_check_person_pending", details: { booking_id: B }, created_at: "2026-11-05T00:00:00Z" }],
    };
    office.length = 0; testMail.length = 0; paused = null; officeResult = { status: "sent", detail: "faked" };
  });
  test("before 5pm the day before: nothing", async () => {
    expect(await sweepReadyCheckPerson(at("2026-11-11T05:00:00Z"))).toEqual({ checked: 0, sent: 0, held: 0 });
    expect(events("ready_check_person_missing")).toHaveLength(0);
  });
  test("real office, flag off: Needs me event written once with Jo's line; email HELD once ('wording not approved yet'); nothing sent", async () => {
    expect(await sweepReadyCheckPerson(at("2026-11-11T06:05:00Z"))).toEqual({ checked: 1, sent: 0, held: 1 });
    await sweepReadyCheckPerson(at("2026-11-11T07:05:00Z"));
    const miss = events("ready_check_person_missing");
    expect(miss).toHaveLength(1);
    expect(miss[0]!.details).toMatchObject({ booking_id: B, needs_office: true, line: "Ready Check tomorrow at 1 Journey Street, Frankston 3199 — nobody picked yet" });
    const held = events("ready_check_person_held");
    expect(held).toHaveLength(1);
    expect(held[0]!.details).toMatchObject({ reason: "wording not approved yet" });
    expect(office).toHaveLength(0);
    expect(events("ready_check_person_email")).toHaveLength(0);
  });
  test("flag on (as at go-live): ONE email to the installer office with Jo's subject, claimed once; a later tick sends nothing more", async () => {
    expect(await sweepReadyCheckPerson(at("2026-11-11T06:05:00Z"), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    await sweepReadyCheckPerson(at("2026-11-11T09:05:00Z"), { approved: true });
    expect(office).toEqual([{ to: "office@journey.example", subject: "HV-3300: who's doing the Ready Check tomorrow?", key: `ready-check-person:v1:${J}:${B}` }]);
    expect(events("ready_check_person_email")).toHaveLength(1);
    expect(events("ready_check_person_missing")).toHaveLength(1);
  });
  test("flag on but the sender blocks → held, not claimed, retried next tick", async () => {
    officeResult = { status: "blocked", detail: "trade messages paused" };
    await sweepReadyCheckPerson(at("2026-11-11T06:05:00Z"), { approved: true });
    expect(events("ready_check_person_email")).toHaveLength(0);
    expect(events("ready_check_person_held")).toHaveLength(1);
    officeResult = { status: "sent", detail: "ok" };
    await sweepReadyCheckPerson(at("2026-11-11T07:05:00Z"), { approved: true });
    expect(office).toHaveLength(2);
    expect(events("ready_check_person_email")).toHaveLength(1);
  });
  test("TEST job → the test sender (recorded once), no flag needed", async () => {
    tables["jobs"]![0]!["source"] = "qa_test";
    await sweepReadyCheckPerson(at("2026-11-11T06:05:00Z"));
    expect(testMail).toEqual([{ to: "office@journey.example", subject: "HV-3300: who's doing the Ready Check tomorrow?" }]);
    expect(events("ready_check_person_email")).toHaveLength(1);
    expect(office).toHaveLength(0);
  });
  test("person picked (a later visit_allocated) → nothing; cancelled job → nothing", async () => {
    tables["workflow_events"]!.push({ id: "e2", job_id: J, event_type: "visit_allocated", details: { visit: "ready_check", worker_id: "w1", worker_name: "Will" }, created_at: "2026-11-06T00:00:00Z" });
    expect(await sweepReadyCheckPerson(at("2026-11-11T06:05:00Z"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(events("ready_check_person_missing")).toHaveLength(0);
    tables["workflow_events"]!.pop();
    tables["jobs"]![0]!["stage"] = "cancelled";
    await sweepReadyCheckPerson(at("2026-11-11T06:05:00Z"), { approved: true });
    expect(events("ready_check_person_missing")).toHaveLength(0);
    expect(office).toHaveLength(0);
  });
});
