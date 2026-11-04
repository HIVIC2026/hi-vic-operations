// Part 3 final fix wave, item 1 (CRITICAL): the "upgrades another day" path, on REAL code against an isolated PGlite
// holding every portal table (tests/helpers/pglite-journey-db.ts). Nothing on the stage path is stubbed — the real
// completePiesaAssessment, autoAdvanceJob (planStep + loadAdvanceFacts), stageEntryBlockers, transition
// (commit_guarded_stage), confirmBooking, bookFromElectricianLink (the Part 6 worker link — Part 2's own-job link steps are
// retired on the joined branch, join step 5 ruling e), the A4 form creation and the A4 completion run here.
// Only the external providers are faked at `fetch` (Mitti, Resend, Twilio, Xero, Stripe — tests/helpers/journey-harness.ts).
//
// Bug (final review at 7604e1b): a live A3 with "upgrades needed" Yes, "doing them today" No and only standard ticks
// makes no rectification_items, so planStep("piesa_complete") with 0 open items aimed at installation scheduling (refused:
// PIESA not passed) and the link's "enter the upgrades day" could not book (the job was never at rectification scheduling).
import { afterAll, describe, expect, mock, test } from "bun:test";
import { fakeProviders, journeyAdmin, journeyDb, loadPendingFunctions, serverFnStandIn, fillAudit, type MittiItem } from "./helpers/journey-harness";

for (const [k, v] of Object.entries({ MITTI_API_TOKEN: "test-mitti", LOVABLE_API_KEY: "test-lovable", RESEND_API_KEY: "test-resend", TWILIO_API_KEY: "test-twilio", TWILIO_FROM_NUMBER: "+61400000000", XERO_API_KEY_1: "test-xero" })) process.env[k] = v;

const TPL_A3 = "template_a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", TPL_A4 = "template_a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4";
const fd = await import("../src/lib/fixes-day.core");
const providers = fakeProviders({ mittiTemplates: {
  [TPL_A4]: { items: fd.FIXES_DAY_QUESTIONS.map((x, i) => ({ item_id: `a4_${i + 1}`, label: x.label, type: x.type === "yes_no" ? "question" : x.type === "photo" ? "media" : x.type === "signature" ? "signature" : x.type === "date" ? "datetime" : "textsingle" })) },
} });
globalThis.fetch = providers.fetchImpl as typeof fetch;

const j = await journeyDb();
await loadPendingFunctions(j);
const { admin, storage } = journeyAdmin(j);
providers.storageFiles.map = storage;
const q = j.q;
afterAll(async () => { await j.db.close(); });

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", serverFnStandIn);
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const realRoute = await import("../src/lib/mitti-test-route.core");
mock.module("../src/lib/mitti-test-route.core", () => ({ ...realRoute, isTestMittiEmail: () => false }));
const pending: Promise<unknown>[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { pending.push(task().catch(() => undefined)); return "wait_until"; } }));
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

const forms = await import("./helpers/journey-forms");
const sc = await import("../src/lib/official-short.core");
const { PIESA_EVIDENCE_BY_ID } = await import("../src/lib/piesa-evidence.core");

// ---- seed: installer + electrician businesses, office, settings ------------------------------------------------------
const INST_BIZ = "30000000-0000-4000-8000-0000000000c1", ELEC_BIZ = "30000000-0000-4000-8000-0000000000c2";
const U_INST = "40000000-0000-4000-8000-0000000000c1", U_ELEC = "40000000-0000-4000-8000-0000000000c2", OFFICE = "40000000-0000-4000-8000-0000000000cf";
const ELEC_EMAIL = "jo@actpropertyinspections.com.au"; // the one Mitti user the fake Mitti knows (journey-harness)
await q(`insert into businesses (id, name, trading_name, abn, business_type, capabilities, is_active, onboarding_status, approved_at, mitti_account_invited, phone, email)
  values ($1,'Flow Insulation','Flow Insulation','11 222 333 444','eec_installer','{installer}',true,'approved',now(),true,'0300000000','office@flow-insulation.example'),
         ($2,'Sparky Co','Sparky Co','22 333 444 555','rec','{electrician}',true,'approved',now(),true,'0411111111',$3)`, [INST_BIZ, ELEC_BIZ, ELEC_EMAIL]);
await q(`insert into profiles (id, full_name, email, phone) values ($1,'Ivy Installer','office@flow-insulation.example','0300000000'), ($2,'Sparky Sam',$3,'0411111111'), ($4,'Ollie Office','office@hivic-test.example',null)`, [U_INST, U_ELEC, ELEC_EMAIL, OFFICE]);
await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true), ($3,$4,'business_admin',true)`, [INST_BIZ, U_INST, ELEC_BIZ, U_ELEC]);
await q(`insert into user_roles (user_id, role) values ($1,'admin')`, [OFFICE]);
const [{ id: WORKER }] = await q<{ id: string }>(`insert into partner_workers (business_id, trade_role, full_legal_name, email, mobile, profile_id, account_status, approval_status, approved_at) values ($1,'electrician','Sparky Sam',$2,'0411111111',$3,'active','approved',now()) returning id`, [ELEC_BIZ, ELEC_EMAIL, U_ELEC]);
// The installer lets the electrician enter the upgrades day on their link (Part 5 who-books "either").
await q("update businesses set piesa_booked_by = 'either' where id = $1", [INST_BIZ]);
await q(`insert into workflow_settings (id, mitti_piesa_template_id, mitti_fixes_template_id, auto_send_mitti, customer_comms_enabled, safety_check_payment_inc_gst, payment_option_gate_enabled, piesa_install_window_days)
  values (1,$1,$2,true,true,349,true,30)`, [TPL_A3, TPL_A4]);

const og = await import("../src/lib/owner-gates.core");
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join("");
for (const d of og.GATE_DOCS) await q("insert into owner_paperwork_approvals (doc_key, doc_version, body_sha256) values ($1,$2,$3)", [d.key, d.version, await sha(d.body)]);
await q("insert into compliance_templates (template_key, approved, is_active) values ('customer_agreement',true,true), ('consumer_rights',true,true)");
const melbToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
const geo = (m: string) => ({ mediaId: m, capturedAt: new Date().toISOString(), lat: -38.14, lng: 145.12 });
type A3 = { upgrades: "Yes" | "No"; today?: "Yes" | "No"; ticks?: string[]; onsiteStart?: "Yes" | "No"; mainsSafe?: "Yes" | "No"; jobNumber?: string };
/** The stored A3 answers (the synced Mitti snapshot) in the Part 3 wording: q20, q30, the plain work ticks, evidence. */
const a3Snapshot = (o: A3) => [
  // The rest of a filled-in A3 (as tests/helpers/journey-forms.ts completedA3): mains safe, no solar, wiring safe, no downlights.
  { label: "Job Reference ID", value: o.jobNumber ?? null },
  { label: "Address including postcode", value: "1 Flow Street, Frankston VIC 3199" },
  { label: "Office life support record", value: "No life support declared" },
  { label: "Electrician licence number", value: "A12345" },
  { label: "Electrician full name", value: "Sparky Sam" },
  { label: "Electrical contractor (REC) business name", value: "Sparky Co" },
  { label: "REC registration number", value: "REC-9999" },
  { label: "Electrician phone", value: "0411111111" },
  { label: "Electrician signature", value: null, media: [geo("sig1")] },
  { label: sc.NO_PRICE_TALK_LABEL, value: "Yes" },
  { label: "Date of inspection", value: melbToday() },
  { label: sc.LIFE_SUPPORT_PRESENT, value: "No" },
  { label: "Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested.", value: o.mainsSafe ?? "Yes" },
  ...(o.mainsSafe === "No" ? [{ label: "Please tick each item that is not right.", value: sc.MAINS_PROBLEMS[0] }, { label: PIESA_EVIDENCE_BY_ID.hazard_photos.label, value: null, media: [geo("hz1")] }] : []),
  { label: "Is there solar, a battery or a generator at the property?", value: "No" },
  { label: "Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?", value: "Yes" },
  { label: "Are there any downlights or other recessed lights in the ceiling?", value: "No" },
  { label: "Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?", value: "No" },
  { label: "I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission", value: "Yes" },
  { label: sc.A3_REPAIR_NEEDED_LABEL, value: o.upgrades },
  ...(o.today ? [{ label: sc.A3_UPGRADES_TODAY_LABEL, value: o.today }] : []),
  ...(o.ticks ? [{ label: sc.FIXES_WORK_LABEL, value: o.ticks.join(", ") }] : []),
  ...(o.onsiteStart ? [{ label: sc.ONSITE_START_LABEL, value: o.onsiteStart }] : []),
  { label: PIESA_EVIDENCE_BY_ID.switchboard_photo.label, value: null, media: [geo("sb1")] },
  { label: PIESA_EVIDENCE_BY_ID.onsite_photo.label, value: null, media: [geo("os1")] },
];

let n = 0;
/** A job exactly as it stands when the A3 is done: quote accepted + agreement signed + safety check paid, electrician
 *  assigned, PIESA booked (piesa_scheduled), A3 synced from Mitti. */
async function seedJob(a3: A3, o: { item?: string } = {}) {
  n++;
  const job = `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const today = melbToday();
  await q(`insert into jobs (id, job_number, stage, channel, source, business_unit) values ($1,$2,'piesa_scheduled','hivic_sourced','website','hivic')`, [job, `HV-F${n}`]);
  await q(`insert into job_assignments (job_id, role, business_id, user_id, active) values ($1,'installer',$2,$3,true), ($1,'electrician',$4,$5,true)`, [job, INST_BIZ, U_INST, ELEC_BIZ, U_ELEC]);
  await q(`insert into customer_agreements (job_id, status) values ($1,'signed')`, [job]);
  const [quote] = await q<{ id: string }>(`insert into quotes (job_id, kind, status, customer_total_inc_gst) values ($1,'installation','accepted',2500) returning id`, [job]);
  await q(`insert into invoices (job_id, kind, quote_id, total_inc_gst, total_paid, deposit_paid_amount) values ($1,'installation',$2,2500,349,349)`, [job, quote!.id]);
  await q(`insert into bookings (job_id, kind, status, scheduled_start, contractor_id, business_id) values ($1,'assessment','confirmed',now() - interval '1 day',$2,$3)`, [job, U_ELEC, ELEC_BIZ]);
  await q(`insert into assessments (job_id, status, external_mitti_id, mitti_raw_snapshot, piesa_outcome, assessed_on, life_support_confirmed, mitti_sync_status, mitti_assignee_email)
    values ($1,'draft',$2,$3,$4,$5,false,'synced',$6)`, [job, `audit-a3-${n}`, JSON.stringify(a3Snapshot({ ...a3, jobNumber: `HV-F${n}` })), a3.upgrades === "Yes" ? "fail" : "pass", today, ELEC_EMAIL]);
  // Owner paperwork A/B signed on Jo-approved wording (the approvals themselves are seeded once below).
  for (const d of og.GATE_DOCS.filter((x) => x.gate === "A" || x.gate === "B"))
    await q(`insert into owner_gate_signatures (job_id, gate, doc_key, doc_version, doc_draft, answers, signatory_name, signed_text, signed_text_sha256, ticked, method, signed_at)
      values ($1,$2,$3,$4,false,'{}'::jsonb,'Harriet Owner',$5,$6,true,'typed_name',now())`, [job, d.gate, d.key, d.version, d.body, await sha(d.body)]);
  if (o.item) await q(`insert into rectification_items (job_id, description, status) values ($1,$2,'required')`, [job, o.item]);
  return job;
}

const stageOf = async (job: string) => (await q<{ stage: string }>("select stage from jobs where id=$1", [job]))[0]!.stage;
const events = (job: string, type: string) => q<{ summary: string; details: Record<string, unknown> }>("select summary, details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [job, type]);
const recent = async (job: string, k = 14) => (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit $2", [job, k])).map((e) => `${e.event_type}: ${e.summary}`);
const why = async (job: string, to: string) => (await import("../src/lib/workflow.server")).stageEntryBlockers(job, to as never);
const completePiesa = async (job: string) => { await debug(job, "BEFORE-COMPLETE"); await (await import("../src/lib/piesa-complete.server")).completePiesaAssessment({ jobId: job }, OFFICE); await settle(); };
const debug = async (job: string, label: string) => {
  if (!process.env["FLOW_DEBUG"]) return;
  const r = await (await import("../src/lib/piesa-rules-notice.server")).piesaRulesFor(job);
  const adv = await (await import("../src/lib/autoadvance.server")).autoAdvanceJob(job, OFFICE, "debug");
  console.log(label, await stageOf(job), JSON.stringify(r?.rules), adv?.stoppedBecause, await recent(job));
};

/** The next business day 9am Melbourne, as the electrician picks it on their link. */
function nextWorkdayIso(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const ymd = d.toISOString().slice(0, 10);
  return new Date(`${ymd}T09:00:00+11:00`).toISOString();
}

describe("Upgrades another day (q20 Yes, q30 No, no items) — the stage route, end to end on real code", () => {
  const STANDARD = [sc.FIXES_DOWNLIGHT_OPTION];
  let JOB = "";
  test("Complete PIESA → rectification scheduling (not parked at PIESA complete)", async () => {
    JOB = await seedJob({ upgrades: "Yes", today: "No", ticks: STANDARD });
    expect((await q("select id from rectification_items where job_id=$1", [JOB]))).toHaveLength(0);
    await completePiesa(JOB);
    await debug(JOB, "AFTER-COMPLETE");
    expect(await stageOf(JOB)).toBe("rectification_scheduling");
  });

  test("the electrician's link shows 'enter the upgrades day' and books it → rectification booked, the A4 form is created once", async () => {
    const link = await import("../src/lib/electrician-link.server");
    const { token } = await link.mintElectricianLink(JOB, WORKER, U_INST);
    expect((await link.electricianLinkView(token)).view).toMatchObject({ step: "set_upgrades_day", canBook: true });
    const start = nextWorkdayIso();
    expect(await link.bookFromElectricianLink(token, "rectification", start)).toEqual({ ok: true, start });
    await settle();
    await debug(JOB, "AFTER-BOOK");
    expect(await q("select status from bookings where job_id=$1 and kind='rectification'", [JOB])).toEqual([{ status: "confirmed" }]);
    expect(await stageOf(JOB)).toBe("rectification_booked");
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A4)).toHaveLength(1);
    expect(await events(JOB, "fixes_form_created")).toHaveLength(1);
    expect((await link.electricianLinkView(token)).view).toMatchObject({ step: "upgrades_day" });
  });

  test("A4 complete without the certificate → post-upgrades record → installation scheduling, waiting for certificate", async () => {
    const a4 = [...providers.mitti.audits.values()].find((a) => a.template_id === TPL_A4)!;
    const Q = fd.FIXES_DAY_Q;
    const m = (x: string) => forms.mediaId(`flow-${x}`);
    const at = new Date().toISOString();
    const items: MittiItem[] = [
      forms.pick(Q.done, "Yes"),
      forms.pick(Q.certificateNow, "No"),
      forms.photo(Q.workPhoto, [m("work")], at),
      forms.signature(Q.signature, m("signature"), at, "Sparky Sam"),
    ];
    for (const id of [m("work"), m("signature")]) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });
    fillAudit(a4, items);
    const out = await (await import("../src/lib/fixes-day.server")).sweepFixesForms();
    await settle();
    await debug(JOB, "AFTER-A4");
    expect(out).toMatchObject({ done: 1 });
    expect(await q("select kind, outcome from piesa_records where job_id=$1 and is_current", [JOB])).toEqual([{ kind: "post_rectification", outcome: "pass" }]);
    expect(await stageOf(JOB)).toBe("installation_scheduling");
    expect((await (await import("../src/lib/certificate-later.server")).jobCertificateFacts(JOB)).state).toBe("waiting_for_certificate");
  });
});

describe("Unchanged routes", () => {
  test("on-site-only A3 (q20 Yes, only 'be on site at the start') → installation scheduling as before", async () => {
    const job = await seedJob({ upgrades: "Yes", today: "No", ticks: [sc.FIXES_ONSITE_OPTION], onsiteStart: "Yes", mainsSafe: "No" });
    await completePiesa(job);
    await debug(job, "ONSITE");
    expect(await stageOf(job)).toBe("installation_scheduling");
    const { loadAdvanceFacts } = await import("../src/lib/autoadvance.server");
    expect((await loadAdvanceFacts(job))).toMatchObject({ upgradesNeeded: false, onsiteStartOnly: true });
  });

  test("q20 No → installation scheduling as before", async () => {
    const job = await seedJob({ upgrades: "No" });
    await completePiesa(job);
    await debug(job, "NO-UPGRADES");
    expect(await stageOf(job)).toBe("installation_scheduling");
  });

  test("a job WITH items is unchanged: the partner-billed route to rectification scheduling", async () => {
    const job = await seedJob({ upgrades: "Yes", today: "No", ticks: [sc.FIXES_DOWNLIGHT_OPTION] }, { item: "Other: odd junction box" });
    await completePiesa(job);
    await debug(job, "WITH-ITEMS");
    expect(await stageOf(job)).toBe("rectification_scheduling");
    expect((await events(job, "stage_changed")).map((e) => e.summary)).toContain("Auto: Partner needs to book rectification");
  });
});

describe("The link never shows a raw stage error", () => {
  test("a job still at PIESA complete (stage wrong) gives a plain reason and books nothing", async () => {
    const job = await seedJob({ upgrades: "Yes", today: "No", ticks: [sc.FIXES_DOWNLIGHT_OPTION] });
    await completePiesa(job);
    // Force the old parked state (e.g. a guard that stopped the move): the link must explain, not leak "A rectification booking can't be made at…".
    await q("update jobs set stage='piesa_complete' where id=$1", [job]);
    await q("update quotes set status='superseded' where job_id=$1", [job]); // keeps auto-advance from moving it on
    const link = await import("../src/lib/electrician-link.server");
    const { token } = await link.mintElectricianLink(job, WORKER, U_INST);
    const r = await link.bookFromElectricianLink(token, "rectification", nextWorkdayIso());
    expect(r.ok).toBe(false);
    const msg = r.ok ? "" : r.message;
    expect(msg).not.toMatch(/can't be made at|Blocked:|WorkflowError/);
    expect(msg).toMatch(/Home Insulation Victoria/);
    expect(await q("select id from bookings where job_id=$1 and kind='rectification'", [job])).toHaveLength(0);
    expect(await events(job, "electrician_link_booked")).toHaveLength(0);
  });
});

void why;
