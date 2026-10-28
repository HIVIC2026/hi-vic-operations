// Decision 366 (Jo 25 Oct 2026, audit F03): electrical fixes after the PIESA, joined up on My job. The owner sees the latest
// fixes quote → Approve (existing acceptance helper, no installer quotes regenerated) → pays the fixes in full (PayNowCard
// `fixes` step) → picks one of the electrician's times → booked. confirmBooking (kind rectification) and
// stageEntryBlockers("rectification_booked") refuse while the fixes are unpaid; jobPaymentView never counts fixes twice.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { ownerFixesNeedsOwner, ownerFixesStep } from "../src/lib/owner-fixes.core";
import { FIXES_NOT_PAID_BLOCKER, fixesCountedCents, fixesPaymentBlocker, paymentPlan, paymentSteps } from "../src/lib/payments.core";
import { planStep, type AdvanceFacts } from "../src/lib/autoadvance.core";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const T0 = "2026-10-26T00:00:00.000Z";
const plus = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

describe("owner fixes step (pure)", () => {
  const f = { quoteStatus: null, paid: false, pickable: 0, pickedAt: null, bookedAt: null } as const;
  test("approve → pay → pick → booking → booked; waiting when no times; declined", () => {
    expect(ownerFixesStep(f)).toBe("none");
    expect(ownerFixesStep({ ...f, quoteStatus: "issued" })).toBe("approve");
    expect(ownerFixesStep({ ...f, quoteStatus: "accepted", pickable: 3 })).toBe("pay"); // never pick before paying
    expect(ownerFixesStep({ ...f, quoteStatus: "accepted", paid: true, pickable: 3 })).toBe("pick");
    expect(ownerFixesStep({ ...f, quoteStatus: "accepted", paid: true })).toBe("waiting_times");
    expect(ownerFixesStep({ ...f, quoteStatus: "accepted", paid: true, pickedAt: T0 })).toBe("booking");
    expect(ownerFixesStep({ ...f, quoteStatus: "accepted", paid: true, bookedAt: T0 })).toBe("booked");
    expect(ownerFixesStep({ ...f, quoteStatus: "declined" })).toBe("declined");
    expect(["approve", "pay", "pick"].every((s) => ownerFixesNeedsOwner(s as never))).toBe(true);
    expect(ownerFixesNeedsOwner("booked")).toBe(false);
  });
});

describe("fixes payment step (payment gate)", () => {
  test("fixes count as their own step only when accepted AFTER the installation quote (never twice)", () => {
    expect(fixesCountedCents({ rectTotalCents: 55_000, rectAcceptedAt: plus(T0, 48), installAcceptedAt: T0 })).toBe(55_000);
    expect(fixesCountedCents({ rectTotalCents: 55_000, rectAcceptedAt: T0, installAcceptedAt: plus(T0, 48) })).toBe(0); // old model: folded in
    expect(fixesCountedCents({ rectTotalCents: 55_000, rectAcceptedAt: null, installAcceptedAt: T0 })).toBe(0);
    const plan = paymentPlan({ quoteTotalCents: 400_000, fixesCents: 55_000 });
    expect(plan.grandTotalCents).toBe(455_000);
    expect(plan.thresholds.fixes).toBe(34_900 + 55_000);
  });
  test("booking blocker until the fixes are paid in full; none without a fixes step", () => {
    const plan = paymentPlan({ quoteTotalCents: 400_000, fixesCents: 55_000 });
    const facts = { safety_check: { requestedAt: T0 }, fixes: { requestedAt: plus(T0, 48) } };
    expect(fixesPaymentBlocker(plan, paymentSteps(plan, 34_900, facts, plus(T0, 50)))).toBe(FIXES_NOT_PAID_BLOCKER);
    expect(fixesPaymentBlocker(plan, paymentSteps(plan, 34_900 + 54_999, facts, plus(T0, 50)))).toBe(FIXES_NOT_PAID_BLOCKER);
    expect(fixesPaymentBlocker(plan, paymentSteps(plan, 34_900 + 55_000, facts, plus(T0, 50)))).toBeNull();
    const none = paymentPlan({ quoteTotalCents: 400_000 });
    expect(fixesPaymentBlocker(none, paymentSteps(none, 0, {}, T0))).toBeNull();
  });
  test("both booking paths carry the fixes-paid blocker", () => {
    expect(read("src/lib/booking.server.ts")).toMatch(/kind === "rectification"\) \{ const fb = await \(await import\("\.\/payments\.server"\)\)\.fixesPaymentBlockerFor\(jobId\)/);
    expect(read("src/lib/workflow.server.ts")).toMatch(/to === "rectification_booked"\) \{\s*const fb = await \(await import\("\.\/payments\.server"\)\)\.fixesPaymentBlockerFor\(jobId\)/);
  });
});

describe("approval stays in the fixes flow", () => {
  const base: AdvanceFacts = { eligibilityConfirmed: true, electricianAssigned: true, assessmentBookingConfirmed: true, openRectItems: 2, rectQuoteIssued: true, rectQuoteAccepted: true, installQuotesIssued: true, installQuoteAccepted: true, consumerSigned: true, invoiceExists: true, depositCleared: true, rectBookingConfirmed: false, installBookingConfirmed: false, installationCompleted: false, installerDeclarationSigned: false, veecLodged: false };
  test("installation quote already accepted → rectification_scheduling, never ready_for_installer_quotes", () => {
    expect(planStep("awaiting_owner_rectification_approval", base)).toMatchObject({ kind: "transition", to: "rectification_scheduling" });
    expect(planStep("awaiting_owner_rectification_approval", { ...base, installQuoteAccepted: false })).toMatchObject({ kind: "transition", to: "ready_for_installer_quotes" });
  });
  test("respondToQuoteImpl: pickLater approval, accepted at the fixes-quote stages, no installer quotes regenerated on the new path", () => {
    const src = read("src/lib/portal.functions.ts");
    const i = src.indexOf("export async function respondToQuoteImpl");
    const body = src.slice(i, src.indexOf("async function invoiceAfterAcceptance"));
    expect(body).toContain(`"awaiting_owner_rectification_approval", "piesa_complete", "electrical_variation_pending", "rectification_required"`);
    expect(body).toContain("data.pickLater");
    const branch = body.slice(body.indexOf("if (installAccepted) {"), body.indexOf("// Old model"));
    expect(branch).toContain(`"rectification_scheduling"`);
    expect(branch).not.toMatch(/genInstaller|ready_for_installer_quotes/);
    expect(branch).toContain("return { ok: true };");
  });
  test("O29's approve link opens the fixes screen", () => {
    expect(read("src/lib/approved-owner-emails.server.ts")).toMatch(/renderFixesQuoteEmail\(\{[^\n]*\?screen=fixes/);
    expect(read("src/routes/my-job.$token.tsx")).toMatch(/"fixes"(, "turn")?\] as const satisfies/);
  });
});

// ---------- owner-fixes.server on PGlite: pay first, then pick → booked through confirmBooking ----------
const db = new PGlite();
await db.exec(`
CREATE TABLE quotes (id uuid primary key, job_id uuid, kind text, status text, version int, customer_total_inc_gst numeric, created_at timestamptz default clock_timestamp());
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, description text, line_total_inc_gst numeric, sort int);
CREATE TABLE appointment_proposals (id uuid primary key, job_id uuid, kind text, electrician_window boolean, starts_at timestamptz, ends_at timestamptz, status text, responded_by uuid, responded_at timestamptz, response_note text);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);
const shim = postgrestShim(db);
// The shim has no embedded resources: answer quotes(…, quote_items(…)) by joining here.
const admin = {
  ...shim,
  from(t: string) {
    if (t !== "quotes") return shim.from(t);
    const b = shim.from(t) as Record<string, (...a: unknown[]) => unknown> & { then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise<unknown> };
    const sel = b.select!, then = b.then.bind(b);
    let embed = false;
    b.select = (c?: unknown, o?: unknown) => { if (typeof c === "string" && c.includes("quote_items(")) { embed = true; c = c.replace(/,\s*quote_items\([^)]*\)/, ""); } return sel(c, o); };
    b.then = (r, j) => then(async (v: unknown) => {
      const x = v as { data: { id: string }[] | null };
      if (embed && Array.isArray(x.data)) for (const q of x.data) (q as Record<string, unknown>)["quote_items"] = (await db.query("select description, line_total_inc_gst, sort from quote_items where quote_id=$1", [q.id])).rows;
      return r(v);
    }, j);
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
let stage = "rectification_scheduling";
let fixesPaid = false;
const booked: { kind: string; start: string }[] = [];
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  getStage: async () => stage,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
mock.module("../src/lib/payments.server", () => ({ fixesPaymentBlockerFor: async () => (fixesPaid ? null : FIXES_NOT_PAID_BLOCKER) }));
mock.module("../src/lib/booking.server", () => ({ confirmBooking: async (jobId: string, kind: string, start: string) => { if (!fixesPaid) throw new WorkflowError(`Blocked: ${FIXES_NOT_PAID_BLOCKER}`); booked.push({ kind, start }); await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,$2,'confirmed',$3)", [jobId, kind, start]); return { ok: true }; } }));
mock.module("../src/lib/install-holds.server", () => ({ moveHoldForRectification: async () => undefined }));
const { ownerFixesState, ownerPickFixesTime, bookPickedFixesTime } = await import("../src/lib/owner-fixes.server");

const JOB = "00000000-0000-0000-0000-00000000f301", Q = "00000000-0000-0000-0000-00000000f302", OWNER = "00000000-0000-0000-0000-00000000f303";
const W1 = "00000000-0000-0000-0000-00000000f311", W2 = "00000000-0000-0000-0000-00000000f312";
const in3d = new Date(Date.now() + 72 * 3_600_000).toISOString(), in4d = new Date(Date.now() + 96 * 3_600_000).toISOString();

beforeEach(async () => {
  await db.exec("delete from quotes; delete from quote_items; delete from appointment_proposals; delete from bookings; delete from workflow_events;");
  await db.query("insert into quotes (id, job_id, kind, status, version, customer_total_inc_gst) values ($1,$2,'rectification','accepted',1,550)", [Q, JOB]);
  await db.query("insert into quote_items (quote_id, description, line_total_inc_gst, sort) values ($1,'Replace damaged cable',550,1)", [Q]);
  for (const [id, s] of [[W1, in3d], [W2, in4d]]) await db.query("insert into appointment_proposals (id, job_id, kind, electrician_window, starts_at, ends_at, status) values ($1,$2,'rectification',true,$3,$3,'proposed')", [id, JOB, s]);
  stage = "rectification_scheduling"; fixesPaid = false; booked.length = 0;
});

describe("owner-fixes.server (PGlite)", () => {
  test("approved but unpaid → step 'pay'; no times shown; picking is refused", async () => {
    const s = await ownerFixesState(JOB);
    expect(s.step).toBe("pay");
    expect(s.windows).toEqual([]);
    expect(s.quote).toMatchObject({ id: Q, total: 550, lines: [{ description: "Replace damaged cable", amount: 550 }] });
    await expect(ownerPickFixesTime(JOB, W1, OWNER)).rejects.toThrow(/pay for the electrical fixes before booking/);
    expect((await db.query<{ status: string }>("select status from appointment_proposals order by starts_at")).rows.map((r) => r.status)).toEqual(["proposed", "proposed"]);
  });
  test("paid → pick one time → others superseded → booked through confirmBooking", async () => {
    fixesPaid = true;
    const s = await ownerFixesState(JOB);
    expect(s.step).toBe("pick");
    expect(s.windows.map((w) => w.id)).toEqual([W1, W2]);
    expect(await ownerPickFixesTime(JOB, W2, OWNER)).toEqual({ ok: true, booked: true });
    expect((await db.query<{ id: string; status: string }>("select id, status from appointment_proposals order by starts_at")).rows.map((r) => r.status)).toEqual(["superseded", "accepted"]);
    expect(booked.map((b) => b.kind)).toEqual(["rectification"]);
    expect(Date.parse(booked[0]!.start)).toBe(Date.parse(in4d));
    expect((await ownerFixesState(JOB)).step).toBe("booked");
    expect(await bookPickedFixesTime(JOB, OWNER)).toBe(false); // never twice
  });
  test("a time picked before payment cleared is booked once the payment lands (afterPaymentsChanged hook)", async () => {
    await db.query("update appointment_proposals set status='accepted', responded_by=$2, responded_at=now() where id=$1", [W1, OWNER]);
    expect(await bookPickedFixesTime(JOB, null)).toBe(false); // unpaid → nothing
    fixesPaid = true;
    expect(await bookPickedFixesTime(JOB, null)).toBe(true);
    expect(booked).toHaveLength(1);
  });
  test("not at fixes scheduling → nothing is booked", async () => {
    fixesPaid = true; stage = "piesa_complete";
    await db.query("update appointment_proposals set status='accepted', responded_by=$2, responded_at=now() where id=$1", [W1, OWNER]);
    expect(await bookPickedFixesTime(JOB, null)).toBe(false);
  });
});
