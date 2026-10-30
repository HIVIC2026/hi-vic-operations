import { beforeEach, afterAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { embedShim } from "./helpers/pglite-embed-shim";
import * as inHouse from "../src/lib/in-house.core";
import * as allocation from "../src/lib/allocation.core";
import * as workflowCore from "../src/lib/workflow";
import * as installDays from "../src/lib/install-days.core";
import * as paymentGateCore from "../src/lib/payment-gate.core";
import * as escCore from "../src/lib/esc.core";
import { INSTALL_DEPOSIT_BLOCKER, FIXES_NOT_PAID_BLOCKER } from "../src/lib/payments.core";

// Actual booking/wrapper/held lookup and ESC preparation bodies; SQL-backed local records only.
// External delivery, Mitti, invoice date sync and unrelated workflow helpers cannot leave this fixture.
const db = new PGlite();
const JOB = "10000000-0000-4000-8000-000000000001";
const BIZ = "20000000-0000-4000-8000-000000000001", OTHER = "20000000-0000-4000-8000-000000000002";
const MEMBER = "30000000-0000-4000-8000-000000000001", OUTSIDER = "30000000-0000-4000-8000-000000000002";
const START = new Date(Date.now() + 5 * 86400000).toISOString();
const DEADLINE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
await db.exec(`
CREATE TYPE booking_kind AS ENUM ('assessment','ready_check','rectification','installation');
CREATE TYPE booking_status AS ENUM ('proposed','confirmed','completed','cancelled');
CREATE TABLE businesses(id uuid primary key, in_house boolean not null default false, rectification_billed_by text not null default 'hivic' CHECK(rectification_billed_by IN ('partner','hivic')), business_type text, onboarding_status text, is_active boolean, capabilities text[]);
CREATE TABLE business_members(id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), user_id uuid, active boolean not null default true, member_role text CHECK(member_role IN ('business_admin','member')));
CREATE TABLE jobs(id uuid primary key, stage text, source text, deleted_at timestamptz, signed boolean, fee_paid boolean, deposit_paid boolean, rectification_paid boolean, piesa_completed boolean, rectification_required boolean, part_c_signed boolean, install_deadline text);
CREATE TABLE job_assignments(id uuid primary key default gen_random_uuid(), job_id uuid references jobs(id), business_id uuid references businesses(id), user_id uuid, role text, active boolean not null default true, booking_confirmed_at timestamptz);
CREATE TABLE bookings(id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id), kind booking_kind not null, contractor_id uuid, assignment_id uuid references job_assignments(id), business_id uuid references businesses(id), scheduled_start timestamptz, scheduled_end timestamptz, booked_by uuid, notes text, status booking_status not null, created_at timestamptz not null default now());
CREATE TABLE workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text not null, summary text, details jsonb, created_at timestamptz default now(), CONSTRAINT workflow_events_job_required CHECK(job_id IS NOT NULL OR event_type=ANY(ARRAY['email_unmatched','email_unmatched_dismissed','email_new_sender_replied','email_nojob_ai_draft','email_nojob_reply_sent','email_nojob_ai_draft_closed','email_nojob_followup_claim','email_nojob_followup_failed','email_nojob_ai_draft_failed'])));
CREATE TABLE esc_notifications(id uuid primary key default gen_random_uuid(), job_id uuid references jobs(id), booking_id uuid references bookings(id), version integer, scheduled_start timestamptz, scheduled_end timestamptz, installation_days jsonb, premises_address text, owner_contact jsonb, consent_id uuid, consent_template_version text, consent_signed_at timestamptz, config_version text, payload_version text, payload_json jsonb, status text CHECK(status IN ('not_ready','configuration_required','ready','pending_submission','sent','accepted','error','stale','cancelled')), due_by timestamptz, earliest_send_at timestamptz, last_error text, updated_at timestamptz, created_at timestamptz default now(), sent_at timestamptz, submission_reference text, submission_method text, CHECK(status NOT IN ('sent','accepted') OR consent_id IS NOT NULL), CHECK(status NOT IN ('sent','accepted') OR (sent_at IS NOT NULL AND submission_reference IS NOT NULL AND submission_method IS NOT NULL)));
`);
const rows = async <T,>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
const job = async () => (await rows<any>("select * from jobs where id=$1", [JOB]))[0];
class WorkflowError extends Error {}
let failHeldRead = false;
let failBillingRead = false;
let rectificationGuardCalls = 0;
const shim = embedShim(db, { job_assignments: { businesses: { table: "businesses", fk: "business_id", on: "base" } } });
const admin = { from(table: string) {
  if (failHeldRead && table === "job_assignments") throw new Error("read unavailable");
  const query = shim.from(table);
  if (table === "job_assignments") {
    const select = query.select;
    query.select = (columns, ...args) => {
      if (failBillingRead && columns === "businesses(in_house, rectification_billed_by)") {
        query.single = async () => ({ data: null, error: { message: "billing read unavailable" } });
      }
      return select(columns, ...args);
    };
  }
  // PGlite's enum-array parameters need PostgreSQL's literal spelling, unlike text/UUID arrays.
  if (table === "bookings") {
    const originalIn = query.in;
    query.in = (column, values) => originalIn(column, `{${values.join(",")}}` as unknown as unknown[]);
  }
  return query;
} };
const logEvent = async (jobId: string, actor: string, event: string, summary: string, details = {}) => {
  await db.query("insert into workflow_events(job_id,actor_id,event_type,summary,details) values($1,$2,$3,$4,$5)", [jobId,actor,event,summary,JSON.stringify(details)]);
};
const gate = async () => ({ ...(await job()).fee_paid ? { cleared: true, option: "safety_check_paid" } : { cleared: false, blocker: paymentGateCore.safetyCheckBlocker(349) } });
const workflow = {
  WorkflowError, logEvent, getStage: async () => (await job()).stage,
  commercialBlocker: async () => null, paymentGate: gate,
  piesaRequestFacts: async () => ({ readyCheckComplete: true, verifiedEligible: true, currentQuoteApproved: (await job()).signed, payment: await gate() }),
  piesaStatus: async () => ({ install_deadline: (await job()).install_deadline, piesa_expired: false }),
  READY_CHECK_BOOKING_RECORD_BLOCKER: "record needed",
  stageEntryBlockers: async () => (await job()).signed ? [] : ["Owner has not approved the current confirmed insulation quote version."],
  transition: async (j: string, stage: string, actor: string, summary: string, details: any) => { await db.query("update jobs set stage=$2 where id=$1", [j,stage]); await logEvent(j,actor,"stage_changed",summary,details); },
};
const clearanceFacts = async () => {
  const j = await job();
  return { piesaOutcome: "pass", piesaCompletedAt: j.piesa_completed ? new Date().toISOString() : null, rectificationRequired: j.rectification_required,
    rectificationQuoteAccepted: true, rectificationCompletedAt: j.rectification_required ? START : null, sectionCSignedAt: j.part_c_signed ? START : null };
};
const overrides: Record<string, any> = {
  "@/integrations/supabase/client.server": { supabaseAdmin: admin },
  "./workflow.server": workflow, "./workflow": workflowCore, "./in-house.core": inHouse,
  "./allocation.core": allocation, "./allocation.server": { clearanceFacts }, "./install-days.core": installDays,
  "./payment-gate.core": paymentGateCore, "./esc.core": escCore,
  "./invoice-dates.server": { setInstallDueDate: async () => {} }, "./autoadvance.server": { autoAdvanceJob: async () => {} },
  "./payments.server": { installDepositBlockerFor: async () => (await job()).deposit_paid ? null : INSTALL_DEPOSIT_BLOCKER,
    fixesPaymentBlockerFor: async () => { rectificationGuardCalls++; return (await job()).rectification_paid ? null : FIXES_NOT_PAID_BLOCKER; } },
  "./piesa-owner-confirm.server": { ownerPiesaConfirmationBlockerFor: async () => null },
  "./job-live.server": { jobDeletedBlocker: async () => null }, "./pilot.server": { requireApprovedPartner: async () => {} },
  "./install-attendance.server": { onInstallBooked: async () => {} }, "./mitti-pickup.server": { updateMittiFormDate: async () => {} },
  "./fixes-day.server": { onRectificationBooked: async () => {} }, "./install-holds.server": { moveHoldForPiesa: async () => {}, moveHoldForRectification: async () => {} },
  "./installer-planning-notice.server": { notifyInstallerPlanning: async () => {} }, "./engagement.server": { recordBookingCompleted: async () => {} },
  "./owner-email-triggers.server": { onSafetyCheckBooked: async () => {} }, "./piesa-autoform.server": { onPiesaBooked: async () => {} },
  "./consent.server": { syncOwnerConsent: async () => {}, currentConsent: async () => null },
  "./consent.core": { consentValidityBlockers: () => [] },
};
// Isolate modules without global mock pollution. Only the ESC helper's unrelated fact reads are stubbed;
// its actual regeneration body persists the notification using the same SQL-backed client.
function load(name: string, cache: Record<string, any> = {}): any {
  if (name in cache) return cache[name];
  let source = readFileSync(`src/lib/${name}.ts`, "utf8");
  if (name === "esc.server") {
    const ast = ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true);
    const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "regenerateEscNotification");
    if (!fn) throw new Error("ESC preparation missing");
    source = fn.getText(ast);
  }
  const extra = name === "esc.server" ? { admin, logEvent, ...escCore,
    snapshot: async () => ({ address: "TEST address", jobNumber: "TEST-1", owner: { name: "TEST Owner", email: null, phone: null } }),
    activeEscConfig: async () => null, notificationFacts: async () => ({ facts: {}, conditions: [] }) } : {};
  const out = {}; cache[name] = out;
  const req = (path: string) => {
    if (path in overrides) return overrides[path];
    if (path.startsWith("./")) return load(path.slice(2), cache);
    // Trade-view's static pure imports are irrelevant to this new member-scoped wrapper.
    if (name === "trade-view.server") return {};
    throw new Error(`Unexpected dependency ${path}`);
  };
  new Function("exports","require",...Object.keys(extra),ts.transpile(source,{ module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022 }))(out,req,...Object.values(extra));
  return out;
}
const book = async (kind = "installation", actor = MEMBER, start = START) => load("trade-view.server").inHouseBookVisit(actor, { jobId: JOB, kind, start });
const patch = async (field: string, value: unknown) => db.query(`update jobs set "${field}"=$1 where id=$2`, [value,JOB]);
beforeEach(async () => {
  failHeldRead = false; failBillingRead = false; rectificationGuardCalls = 0;
  await db.exec("truncate esc_notifications,workflow_events,bookings,job_assignments,business_members,jobs,businesses cascade");
  await db.query("insert into businesses(id,in_house,rectification_billed_by,business_type,onboarding_status,is_active,capabilities) values($1,true,'partner','eec_installer','approved',true,ARRAY['installer','electrician']),($2,false,'hivic','eec_installer','approved',true,ARRAY['installer'])", [BIZ,OTHER]);
  await db.query("insert into business_members(business_id,user_id,member_role) values($1,$2,'member'),($3,$4,'business_admin')", [BIZ,MEMBER,OTHER,OUTSIDER]);
  await db.query("insert into jobs values($1,'installation_scheduling','base44',null,true,true,true,false,true,false,true,$2)",[JOB,DEADLINE]);
  for (const role of ["installer","electrician"]) await db.query("insert into job_assignments(job_id,business_id,user_id,role) values($1,$2,$3,$4)",[JOB,BIZ,MEMBER,role]);
});
afterAll(async () => db.close());

test("unpaid 10% deposit returns the existing blocker without booking", async () => {
  await patch("deposit_paid",false);
  expect(await book()).toEqual({ ok: false, blockers: [`Blocked: ${INSTALL_DEPOSIT_BLOCKER}`] });
  expect(await rows("select id from bookings")).toHaveLength(0);
});
test("outside the 30-day PIESA window returns the existing date blocker", async () => {
  await patch("install_deadline","2026-10-01");
  expect(await book()).toEqual({ ok: false, blockers: ["Installation must be before the PIESA deadline (2026-10-01)."] });
  expect(await rows("select id from bookings")).toHaveLength(0);
});
test("PIESA not complete returns the existing electrical clearance blocker", async () => {
  await patch("piesa_completed",false);
  expect(await book()).toEqual({ ok: false, blockers: ["Installation cannot be arranged yet: PIESA not completed and signed yet."] });
});
test("required Part C unsigned returns the existing clearance blocker", async () => {
  await patch("rectification_required",true); await patch("part_c_signed",false);
  expect(await book()).toEqual({ ok: false, blockers: ["Installation cannot be arranged yet: Section C not completed and signed yet."] });
});
test("owner acceptance still blocks installation", async () => {
  await patch("signed",false);
  expect(await book()).toEqual({ ok: false, blockers: ["Blocked: Owner has not approved the current confirmed insulation quote version."] });
});
test("all installation guards pass: booking, ESC notification and job audit persist", async () => {
  const r = await book(); expect(r.ok).toBe(true);
  const saved = await rows<any>("select * from bookings");
  expect(r.bookingId).toBe(saved[0]?.id); expect(saved[0]?.status).toBe("confirmed");
  expect(await rows("select id from esc_notifications where booking_id=$1",[r.bookingId])).toHaveLength(1);
  expect(await rows("select id from workflow_events where job_id=$1 and actor_id=$2",[JOB,MEMBER])).toHaveLength(2);
});
test("assessment refuses until its $349 fee is paid", async () => {
  await patch("stage","piesa_and_install_window_pending"); await patch("fee_paid",false);
  expect(await book("assessment")).toEqual({ ok: false, blockers: [`The PIESA cannot be booked yet: ${paymentGateCore.safetyCheckBlocker(349)}`] });
  await patch("fee_paid",true); expect((await book("assessment")).ok).toBe(true);
});
test("partner-billed rectification skips only the HIV rectification payment guard", async () => {
  await patch("stage","rectification_scheduling");
  expect((await book("rectification")).ok).toBe(true); expect(rectificationGuardCalls).toBe(0);
});
test("Home Insulation Victoria billed rectification still requires upfront payment", async () => {
  await patch("stage","rectification_scheduling"); await db.query("update businesses set rectification_billed_by='hivic' where id=$1",[BIZ]);
  expect(await book("rectification")).toEqual({ ok: false, blockers: [`Blocked: ${FIXES_NOT_PAID_BLOCKER}`] });
  expect(rectificationGuardCalls).toBe(1);
  await patch("rectification_paid",true); expect((await book("rectification")).ok).toBe(true);
});
test("non-in-house partner setting cannot bypass the existing rectification payment gate", async () => {
  await patch("stage","rectification_scheduling"); await db.query("update businesses set in_house=false where id=$1",[BIZ]);
  await expect(load("booking.server").confirmBooking(JOB,"rectification",START,MEMBER,"partner")).rejects.toThrow(`Blocked: ${FIXES_NOT_PAID_BLOCKER}`);
  expect(rectificationGuardCalls).toBe(1);
  expect(await rows("select id from bookings")).toHaveLength(0);
});
for (const point of ["held", "billing"] as const) {
  test(`direct rectification booking fails closed when the ${point} read fails`, async () => {
    await patch("stage", "rectification_scheduling");
    failHeldRead = point === "held"; failBillingRead = point === "billing";
    await expect(load("booking.server").confirmBooking(JOB, "rectification", START, MEMBER, "partner"))
      .rejects.toThrow("Couldn't check the job's partner — please try again.");
    expect(await rows("select id from bookings")).toHaveLength(0);
    expect(await rows("select id from workflow_events")).toHaveLength(0);
    // Prove the read failure cannot become the partner-billed payment exception.
    failHeldRead = false; failBillingRead = false;
    await db.query("update businesses set rectification_billed_by='hivic' where id=$1", [BIZ]);
    await expect(load("booking.server").confirmBooking(JOB, "rectification", START, MEMBER, "partner"))
      .rejects.toThrow(`Blocked: ${FIXES_NOT_PAID_BLOCKER}`);
    expect(rectificationGuardCalls).toBe(1);
    expect(await rows("select id from bookings")).toHaveLength(0);
  });
}
test("other business member is forbidden and cannot see booking controls", async () => {
  expect(await book("installation",OUTSIDER)).toEqual({ ok: false, blockers: ["forbidden"] });
  expect((await load("trade-view.server").inHouseBookingAccess(OUTSIDER,JOB)).allowed).toBe(false);
  expect(await rows("select id from bookings")).toHaveLength(0);
});
test("held lookup read failure fails closed", async () => {
  failHeldRead = true;
  expect(await book()).toEqual({ ok: false, blockers: ["Couldn't check the job's partner — please try again."] });
  expect(await rows("select id from bookings")).toHaveLength(0);
});
test("TEST and deleted jobs are excluded only from this new booking surface", async () => {
  await patch("source","qa_test"); expect(await book()).toEqual({ ok: false, blockers: ["forbidden"] });
  await patch("source","base44"); await patch("deleted_at",START); expect(await book()).toEqual({ ok: false, blockers: ["forbidden"] });
});
test("Ready Check also uses the existing booking writer", async () => {
  await patch("stage","ready_check_ready_to_schedule"); expect((await book("ready_check")).ok).toBe(true);
  expect(await rows("select id from bookings where kind='ready_check'")).toHaveLength(1);
});

// Execute the real page's card-selection conditions, rather than matching source strings.
function pageCardConditions(component: string, access: unknown, panel = "offer_install_days") {
  const source = ts.createSourceFile("field.tsx", readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const conditions: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression)) {
      const e = node.expression;
      if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && ts.isJsxSelfClosingElement(e.right) && e.right.tagName.getText(source) === component) conditions.push(e.left.getText(source));
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return conditions.map(condition => new Function("inHouseAccess", "role", "next", "job", "a1ReadyCheckEntryAllowed", `return ${condition}`)(access, "electrician", { panel }, { channel: "installer_sourced", stage: "ready_check_ready_to_schedule" }, () => true));
}
for (const state of ["loading", "error"]) {
  test(`${state} in-house access keeps legacy scheduling available and hides partner controls`, () => {
    const access = { data: undefined, isLoading: state === "loading", isError: state === "error" };
    for (const component of ["ElectricianPiesaTimesCard", "FixesTimesCard", "InstallerInstallDays", "InstallerReadyCheckTimesCard", "A1ReadyCheckTimeCard"]) {
      const panel = component === "InstallerReadyCheckTimesCard" ? "ready_check_offer_times" : component === "A1ReadyCheckTimeCard" ? "ready_check_set_time" : "offer_install_days";
      expect(pageCardConditions(component, access, panel)).toEqual([true]);
    }
    expect(renderBookingCard(access)).toBe("");
  });
}
test("in-house install keeps its booked panel but not the legacy offer panel", () => {
  expect(pageCardConditions("InstallerInstallDays", { data: { allowed: true } }, "install_booked")).toEqual([true]);
  expect(pageCardConditions("InstallerInstallDays", { data: { allowed: true } }, "offer_install_days")).toEqual([false]);
});
function renderBookingCard(access: unknown) {
  const out: any = {};
  const element = (props: any) => React.createElement("div", props, props.children);
  const deps: Record<string, any> = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQuery: () => access, useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "@tanstack/react-start": { useServerFn: (fn: unknown) => fn }, sonner: { toast: {} },
    "@/lib/trade-view.functions": {}, "@/lib/install-days.core": installDays,
    "@/lib/office-list-refresh": { markOfficeChanged: () => {} },
    "@/components/ui/input": { Input: (p: any) => React.createElement("input", p) },
    "@/components/ui/label": { Label: element }, "@/components/ui/button": { Button: element }, "./installer-kit": { Group: element },
  };
  const code = ts.transpile(readFileSync("src/components/trade/InHouseBookingCard.tsx", "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX });
  new Function("exports", "require", code)(out, (path: string) => deps[path]);
  return renderToStaticMarkup(React.createElement(out.InHouseBookingCard, { jobId: JOB }));
}
test("partner card shows the current booking date, Melbourne time and status for every visit", () => {
  const bookings = ["ready_check", "assessment", "rectification", "installation"].map(kind => ({ id: kind, kind, scheduled_start: "2026-11-02T22:00:00.000Z", status: "confirmed" }));
  const html = renderBookingCard({ data: { allowed: true, blockers: [], bookings } });
  expect(html.match(/3 Nov 2026/g)).toHaveLength(4);
  expect(html.match(/9:00 am/g)).toHaveLength(4);
  expect(html.match(/Confirmed/g)).toHaveLength(4);
});
test("current bookings are read only for the job's own active in-house member", async () => {
  await book("installation");
  const own = await load("trade-view.server").inHouseBookingAccess(MEMBER, JOB);
  expect(own.bookings).toHaveLength(1);
  expect(own.bookings[0]).toMatchObject({ kind: "installation", status: "confirmed" });
  expect((await load("trade-view.server").inHouseBookingAccess(OUTSIDER, JOB)).bookings ?? []).toEqual([]);
});