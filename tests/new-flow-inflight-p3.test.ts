// Part 3 Task 20: in-flight jobs get exactly ONE version (old or new) of each Part 3 message.
//
// The six stages are the brief's; each is mapped to the real job stage it stands for. For every stage and every Part 3
// message the real sender runs against an in-memory database with every Part 3 *_APPROVED flag forced ON, and the
// number of sends is counted:
//   - the message belongs to an EARLIER step (the job is past it): the OLD message was already sent (seeded with the
//     keys the code used BEFORE Part 3; they are written out as literals below) -> 0 sends;
//   - the message belongs to THIS step: old already sent -> 0 sends; not sent yet -> exactly 1 send, the new version;
//   - the message belongs to a LATER step: its trigger fires later -> exactly 1 send, the new version, and a second
//     sweep sends nothing more.
// The same cells then run with the flags OFF: a job gets the old version or (where the old wording is gone) nothing,
// never both. Senders are real; only the database, the mail/text transports and the approval flags are replaced.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

/* ------------------------------------------------------------------ fake world */
const tables: Tables = new Proxy({} as Tables, { get: (t, k: string) => (t[k] ??= []) });
const reset = () => { for (const k of Object.keys(tables)) delete (tables as Record<string, unknown>)[k]; };
type Sent = { channel: "email" | "sms"; purpose: string; key: string; subject?: string; text: string };
let sent: Sent[] = [];
const admin = memoryPostgrest(tables);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Record<string, unknown> = {}) => { tables.workflow_events!.push({ job_id, actor_id, event_type, summary, details }); },
}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
mock.module("../src/lib/in-house-suppression.server", () => ({
  readInHouseDispatchState: async (ids: string[]) => ({ failed: false, held: new Set(ids) }),
  inHouseDispatchSkip: async () => null,
}));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/unsubscribe/x" }));
// The guarded sender's real contract: one row per idempotency key (unique index in the database); a second try is "already attempted".
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { jobId: string; purpose: string; key: string; build: (u: string | null) => { subject: string; text: string } }) => {
    if (tables.customer_email_sends!.some((r) => r.idempotency_key === p.key)) return "already attempted — not resent";
    tables.customer_email_sends!.push({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key, status: "sent" });
    const m = p.build("https://u");
    sent.push({ channel: "email", purpose: p.purpose, key: p.key, subject: m.subject, text: m.text });
    return "sent";
  },
}));
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (p: { type: string; idempotencyKey: string; body: string }) => {
    if (tables.sms_messages!.some((r) => r.idempotency_key === p.idempotencyKey)) return { status: "already", detail: "already" };
    tables.sms_messages!.push({ idempotency_key: p.idempotencyKey, type: p.type });
    sent.push({ channel: "sms", purpose: p.type, key: p.idempotencyKey, text: p.body });
    return { status: "sent", detail: "ok", sid: "s" };
  },
}));
mock.module("../src/lib/office-email.server", () => ({
  sendOfficeEmail: async (p: { label: string; subject: string; message: string; idempotencyKey?: string }) => {
    sent.push({ channel: "email", purpose: p.label, key: p.idempotencyKey ?? "", subject: p.subject, text: p.message });
    return { status: "sent", detail: "ok" };
  },
}));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async () => ({ status: "sent", detail: "TEST" }), sendTestSms: async () => ({ status: "sent", detail: "TEST" }) }));
mock.module("../src/lib/test-send.core", () => ({ isTestPartner: () => false }));
mock.module("../src/lib/qa-inbox.server", () => ({ qaDeliveryHeld: async () => false }));
const OFFICE = { name: "Reinsulate Pty Ltd", tradingName: "Reinsulate", officePhone: "03 9000 0000", email: "office@reinsulate.example" };
mock.module("../src/lib/owner-contact.server", () => ({ businessContactForJob: async () => OFFICE }));
mock.module("../src/lib/customer-agreement.server", () => ({ activeCustomerAgreement: async () => ({ version: "1.3", body: "BODY", approvedAt: "2026-11-02T00:00:00Z" }) }));
mock.module("../src/lib/customer-agreement-pdf.server", () => ({
  PAYMENT_TERMS_BLOCK_ID: "payment-terms",
  agreementBlocks: () => [{ kind: "header", id: "x" }, { kind: "pageBreak" }, { kind: "header", id: "payment-terms" }],
  customerAgreementPdf: async (t: { version: string }) => ({ bytes: new Uint8Array([37, 80, 68, 70]), layout: {}, fileName: `Customer-Agreement-and-payment-terms-v${t.version}.pdf` }),
}));
const realSor = { ...(await import("../src/lib/statement-of-rights.core")) };
mock.module("../src/lib/statement-of-rights.core", () => ({ ...realSor, statementOfRightsPdf: () => new Uint8Array([37, 80, 68, 70]) }));

/* ------------------------------------------------------------------ the flags */
// Every Part 3 flag that picks old vs new wording for a job that is already in flight. (WILL_CALL and the
// booked notice take their flag as an argument, below.) QUOTE_30_DAY_FROM_ISO is set to a cutover only when "on".
const real = {
  quoteEmail: { ...(await import("../src/lib/owner-quote-email.core")) },
  chase: { ...(await import("../src/lib/ready-check-chase.core")) },
  accepted: { ...(await import("../src/lib/installer-accepted-email.core")) },
  expiry: { ...(await import("../src/lib/quote-expiry.core")) },
};
const CUTOVER = "2026-11-05T00:00:00Z";
let flagsOn = true;
function setFlags(on: boolean) {
  flagsOn = on;
  mock.module("../src/lib/owner-quote-email.core", () => ({ ...real.quoteEmail, OWNER_QUOTE_EMAIL_V4_APPROVED: on }));
  mock.module("../src/lib/ready-check-chase.core", () => ({ ...real.chase, READY_CHECK_CHASE_EMAIL_APPROVED: on }));
  mock.module("../src/lib/installer-accepted-email.core", () => ({ ...real.accepted, INSTALLER_ACCEPTED_V2_APPROVED: on }));
  mock.module("../src/lib/quote-expiry.core", () => ({
    ...real.expiry,
    QUOTE_30_DAY_FROM_ISO: on ? CUTOVER : null,
    quoteValidDaysFor: (s: string | Date) => real.expiry.quoteValidDaysFor(s, on ? CUTOVER : null),
    quoteExpiresAt: (s: string | Date) => real.expiry.quoteExpiresAt(s, on ? CUTOVER : null),
  }));
}
setFlags(true);
const { sendInHousePartnerCall, sweepInHousePartnerCalls } = await import("../src/lib/in-house-batch-email.server");
const { notifyOwnerBooked, sweepOwnerBookedNotices } = await import("../src/lib/in-house-booking.server");
const { recordReadyCheckProgress } = await import("../src/lib/ready-check-chase.server");
const { notifyOwnerQuoteReady } = await import("../src/lib/quote-ready-notify.server");
const { emailInstallerQuoteAccepted } = await import("../src/lib/installer-accepted-email.server");
const { OWNER_BOOKED_V2_APPROVED } = await import("../src/lib/owner-booked-notice.core");
const { quoteTimerAction, quoteValidDaysFor } = real.expiry;

/* ------------------------------------------------------------------ stages and messages */
// The brief's six stages -> the real job stage each stands for, and the step number of the message due there.
const STAGES = [
  { name: "ready_check_ready_to_schedule", job: "ready_check_ready_to_schedule", step: 1 }, // handed to the installer, nothing booked
  { name: "ready_check_booking", job: "ready_check_ready_to_schedule", step: 2 },            // installer is booking the Ready Check
  { name: "ready_check_booked", job: "ready_check_scheduled", step: 3 },                    // Ready Check booked, form being filled in
  { name: "measured_quote_ready", job: "measured_estimate_ready", step: 4 },                // measured quote released to the owner
  { name: "awaiting_quote_acceptance", job: "awaiting_quote_acceptance", step: 5 },         // owner has the quote; reminders run
  { name: "measured_quote_accepted", job: "measured_quote_accepted", step: 6 },             // owner accepted
] as const;
type Stage = (typeof STAGES)[number];

const J = "j1", Q = "q1", BK = "bk1", WORKER = "w1", AUDIT = "a1";
const NOW = new Date("2026-11-03T01:00:00Z"); // 12pm Melbourne
const BOOK_START = "2026-11-10T00:00:00.000Z";
const MISSING_SIG = "whether the homeowner agrees to be contacted"; // what an empty completed form is missing

function world(stage: string) {
  reset(); sent = [];
  tables.owners!.push({ id: "o1", email: "owner@example.com", full_name: "Courtney Smith", phone: "0400000000" });
  tables.properties!.push({ id: "p1", address_line: "2A Chatfield Street", suburb: "Kingsville", postcode: "3012" });
  tables.jobs!.push({ id: J, owner_id: "o1", property_id: "p1", job_number: "HV-1234", source: "website", stage, deleted_at: null, channel: "hivic_sourced" });
  tables.businesses!.push({ id: "b1", name: OFFICE.name, trading_name: OFFICE.tradingName, phone: OFFICE.officePhone, email: OFFICE.email, signer_mobile: "0411111111", onboarding_status: "approved", is_active: true });
  tables.job_assignments!.push({ job_id: J, role: "installer", active: true, business_id: "b1", user_id: "u1" });
  tables.profiles!.push({ id: "u1", full_name: "Sam Installer", email: "sam@reinsulate.example" });
  tables.workflow_settings!.push({ id: 1, mitti_auto_quote_enabled: true });
  tables.workflow_events!.push({ id: "pend1", job_id: J, event_type: "in_house_partner_call_email_pending", created_at: "2026-11-02T00:00:00Z", details: { business_id: "b1" } });
  tables.quotes!.push({ id: Q, job_id: J, kind: "installation", status: "issued", release_state: "released", sent_at: "2026-11-10T01:00:00Z", customer_total_inc_gst: 1918, veec_discount_inc_gst: 1850, subtotal_inc_gst: 3768 });
  tables.quote_items!.push({ quote_id: Q, description: "R5.0 ceiling insulation", line_total_inc_gst: 3070, sort: 1, code: "INSTALL" }, { quote_id: Q, description: "Electrical safety check (PIESA)", line_total_inc_gst: 349, sort: 2, code: "PIESA" });
  tables.customer_estimate_links!.push({ job_id: J, purpose: "step3_estimate", token: "tok", status: "active", expires_at: "2099-01-01" });
  tables.ceiling_measurements!.push({ job_id: J, is_current: true, measured_area_m2: 120, verified_area_m2: 120, removal_required: false, removal_m2: null });
  tables.lead_campaign_responses!.push({ job_id: J, saved_total: 1630, saved_area_m2: 100, saved_veu_discount: 1850 });
  tables.workflow_events!.push({ job_id: J, event_type: "mitti_product_recorded", details: { product: { option: "Bradford Gold R5.0" } }, created_at: "2026-11-09T00:00:00Z" });
}
const newBooking = () => { if (!tables.bookings!.length) tables.bookings!.push({ id: BK, job_id: J, kind: "ready_check", status: "confirmed", scheduled_start: BOOK_START, created_at: NOW.toISOString() }); };

type Msg = {
  id: string;
  step: number;
  /** What the code left behind when it sent the OLD version (literal keys from before Part 3, base 5c146b5). */
  seedOld: () => void;
  /** Make the trigger fire and run the real sender (twice: a sweep must never double up). */
  fire: () => Promise<void>;
  /** True only for the NEW wording. */
  isNew: (s: Sent) => boolean;
  /** When only one channel changes wording, the other channel is not checked for old/new. */
  wordingChannel?: "email" | "sms";
  /** Sends that belong to this message. */
  mine: (s: Sent) => boolean;
  /** Flags OFF and nothing sent before: the old wording goes ("old"), or nothing because the old wording is gone ("nothing"). */
  whenOff: "old" | "nothing";
};
const MESSAGES: Msg[] = [
  {
    id: "will_call", step: 1, whenOff: "nothing",
    seedOld: () => { tables.customer_email_sends!.push({ job_id: J, purpose: "in_house_partner_call", idempotency_key: `in-house-partner-call:v1:${J}`, status: "sent" }); },
    fire: async () => {
      const deps = {
        approved: flagsOn, now: () => NOW, contactFor: async () => OFFICE, assertAllowed: async () => undefined, db: admin as never,
        sendEmail: async (p: { jobId: string; purpose: string; key: string; build: (u: string | null) => { subject: string; text: string } }) => {
          if (tables.customer_email_sends!.some((r) => r.idempotency_key === p.key)) return "already attempted — not resent";
          tables.customer_email_sends!.push({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key });
          const m = p.build(null); sent.push({ channel: "email", purpose: p.purpose, key: p.key, subject: m.subject, text: m.text }); return "sent";
        },
        sendSms: async (i: { type: string; idempotencyKey: string; body: string }) => { sent.push({ channel: "sms", purpose: i.type, key: i.idempotencyKey, text: i.body }); return { status: "sent", detail: "ok" } as never; },
        logEvent: async (j: string, a: string | null, t: string, s: string, d: Record<string, unknown> = {}) => { tables.workflow_events!.push({ job_id: j, actor_id: a, event_type: t, summary: s, details: d }); },
      };
      await sendInHousePartnerCall(J, deps as never);
      await sweepInHousePartnerCalls(deps as never);
    },
    isNew: (s) => /will call you/.test(`${s.subject ?? ""} ${s.text}`),
    mine: (s) => s.purpose === "in_house_partner_call" || s.purpose === "owner_will_call",
  },
  {
    id: "booked", step: 3, whenOff: "old",
    seedOld: () => { newBooking(); tables.customer_email_sends!.push({ job_id: J, purpose: "in_house_booked", idempotency_key: `in-house-booked:v1:${BK}:${WORKER}`, status: "sent" }); tables.sms_messages!.push({ idempotency_key: `in-house-booked:v1:${BK}:${WORKER}:sms`, type: "in_house_booked_owner" }); },
    fire: async () => {
      newBooking();
      const v2Approved = { ...OWNER_BOOKED_V2_APPROVED, ready_check: flagsOn };
      await notifyOwnerBooked(J, "ready_check", BOOK_START, { id: WORKER, name: "Sam", phone: "0422222222" }, NOW, { v2Approved });
      await sweepOwnerBookedNotices(NOW, { v2Approved });
    },
    // old wording names the worker's phone ("phone 0422222222"); the new one never shows a worker's number
    isNew: (s) => !/0422222222/.test(s.text),
    mine: (s) => s.purpose === "in_house_booked" || s.purpose === "in_house_booked_owner",
  },
  {
    id: "nearly_there", step: 3, whenOff: "old",
    seedOld: () => { tables.sms_messages!.push({ idempotency_key: `ready-check-incomplete:v1:${J}:${AUDIT}:${MISSING_SIG}`, type: "ready_check_incomplete" }); tables.workflow_events!.push({ job_id: J, event_type: "ready_check_incomplete", details: { signature: MISSING_SIG }, created_at: "2026-11-02T00:00:00Z" }); },
    fire: async () => { await recordReadyCheckProgress({ jobId: J, actorId: null, auditId: AUDIT, entries: [], completed: true, modifiedAt: null, priced: false, now: NOW }); },
    isNew: (s) => s.channel === "email",
    mine: (s) => s.purpose === "ready_check_incomplete" || s.purpose === "ready_check_nearly_there",
  },
  {
    id: "quote_email", step: 4, whenOff: "old",
    seedOld: () => { tables.customer_email_sends!.push({ job_id: J, purpose: "quote_ready", idempotency_key: `quote-ready-email:v1:${Q}`, status: "sent" }); tables.sms_messages!.push({ idempotency_key: `quote-ready:v1:${Q}`, type: "quote_ready" }); },
    fire: async () => { await notifyOwnerQuoteReady(J, Q, "installation"); },
    // the quote text is the same in both versions; only the email changes
    isNew: (s) => /What's changed from your estimate/.test(s.text),
    wordingChannel: "email",
    mine: (s) => s.purpose === "quote_ready",
  },
  {
    id: "owner_accepted", step: 6, whenOff: "old",
    seedOld: () => { tables.workflow_events!.push({ job_id: J, event_type: "installer_accepted_email", details: { quote_id: Q, status: "sent" }, created_at: "2026-11-09T00:00:00Z" }); },
    fire: async () => { await emailInstallerQuoteAccepted(J, Q); },
    isNew: (s) => /Book the PIESA|has paid the \$349 for the PIESA/.test(s.text),
    mine: (s) => s.purpose === "installer_quote_accepted",
  },
];

/** The relation of a message's step to the stage the job is in. */
const rel = (stage: Stage, m: Msg) => (m.step < stage.step ? "past" : m.step === stage.step ? "this" : "later");
const emails = (xs: Sent[]) => xs.filter((s) => s.channel === "email");

describe("matrix: every Part 3 flag ON", () => {
  beforeEach(() => setFlags(true));
  for (const stage of STAGES) {
    for (const m of MESSAGES) {
      const r = rel(stage, m);
      if (r === "past" || r === "this") {
        test(`${stage.name} x ${m.id} [${r === "past" ? "past this step" : "this step"}, old version already sent] -> nothing new`, async () => {
          world(stage.job); m.seedOld();
          await m.fire();
          expect(sent.filter(m.mine)).toEqual([]);
        });
      }
      if (r === "this" || r === "later") {
        test(`${stage.name} x ${m.id} [${r === "this" ? "this step, old NOT sent" : "later step"}] -> exactly one, the new version, once`, async () => {
          world(stage.job);
          await m.fire();
          const mine = sent.filter(m.mine);
          expect(emails(mine)).toHaveLength(1);
          for (const s of mine.filter((x) => !m.wordingChannel || x.channel === m.wordingChannel)) expect(m.isNew(s)).toBe(true);
          const n = sent.length; await m.fire(); expect(sent.length).toBe(n); // a second sweep adds nothing
        });
      }
    }
  }
});

describe("matrix: every Part 3 flag OFF - the old version (or nothing where the old wording is gone), never both", () => {
  beforeEach(() => setFlags(false));
  for (const m of MESSAGES) {
    test(`${m.id}: nothing sent yet -> ${m.whenOff === "old" ? "old version once" : "nothing"}, never the new wording`, async () => {
      world("ready_check_scheduled");
      await m.fire();
      const mine = sent.filter(m.mine);
      for (const s of mine.filter((x) => !m.wordingChannel || x.channel === m.wordingChannel)) expect(m.isNew(s)).toBe(false);
      if (m.whenOff === "nothing") expect(mine).toHaveLength(0);
      else expect(mine.length).toBeGreaterThan(0);
      const n = sent.length; await m.fire(); expect(sent.length).toBe(n);
    });
    test(`${m.id}: old already sent -> nothing`, async () => {
      world("ready_check_scheduled"); m.seedOld();
      await m.fire();
      expect(sent.filter(m.mine)).toEqual([]);
    });
  }
});

describe("flag flipped part-way through: still one version per booking / chase revision", () => {
  const booked = MESSAGES.find((m) => m.id === "booked")!, chase = MESSAGES.find((m) => m.id === "nearly_there")!;
  test("a booking whose old email and text went with the flag off gets nothing more when the flag goes on", async () => {
    setFlags(false); world("ready_check_scheduled");
    await booked.fire();
    const first = sent.filter(booked.mine).length;
    expect(first).toBeGreaterThan(0);
    setFlags(true);
    await booked.fire();
    expect(sent.filter(booked.mine)).toHaveLength(first);
  });
  test("a chase revision texted with the flag off is not also emailed when the flag goes on (same gap list)", async () => {
    setFlags(false); world("ready_check_scheduled");
    await chase.fire();
    expect(sent.filter(chase.mine).map((s) => s.channel)).toEqual(["sms"]);
    setFlags(true);
    await chase.fire();
    expect(sent.filter(chase.mine).map((s) => s.channel)).toEqual(["sms"]);
  });
  test("a chase revision with a NEW gap list after the flag goes on is emailed only: one version per revision", async () => {
    setFlags(false); world("ready_check_scheduled");
    await chase.fire();
    setFlags(true);
    tables.workflow_events!.length = 0;
    tables.workflow_events!.push({ job_id: J, event_type: "ready_check_incomplete", details: { signature: "an older list" }, created_at: "2026-11-02T00:00:00Z" });
    await recordReadyCheckProgress({ jobId: J, actorId: null, auditId: "a2", entries: [], completed: true, modifiedAt: null, priced: false, now: NOW });
    expect(sent.filter(chase.mine).map((s) => s.channel).sort()).toEqual(["email", "sms"]); // old text for revision 1, new email for revision 2
  });
});

describe("quote reminders and expiry (T9): the cutover decides per quote, nothing is sent twice", () => {
  const base = { kind: "installation", status: "issued", nudge_day3_at: null as string | null, nudge_day10_at: null as string | null };
  const sentBefore = "2026-11-01T01:00:00Z"; // sent before the cutover: 14 days with the flag on or off
  const sentAfter = "2026-11-10T01:00:00Z";  // sent after: 30 days (14 while the cutover is not set)
  test("valid days: a quote sent before the cutover keeps 14 days; after it 30; no cutover -> 14", () => {
    expect(quoteValidDaysFor(sentBefore, CUTOVER)).toBe(14);
    expect(quoteValidDaysFor(sentBefore, null)).toBe(14);
    expect(quoteValidDaysFor(sentAfter, CUTOVER)).toBe(30);
    expect(quoteValidDaysFor(sentAfter, null)).toBe(14);
  });
  test("an in-flight 14-day quote that already had its day-10 point gets no second expiry nudge", () => {
    const q = { ...base, sent_at: sentBefore, nudge_day3_at: "x", nudge_day10_at: "y" };
    for (const day of ["2026-11-12T01:00:00Z", "2026-11-14T01:00:00Z", "2026-11-14T12:00:00Z"]) expect(quoteTimerAction(q, new Date(day), CUTOVER)).toBeNull();
  });
  test("an in-flight 14-day quote with no expiry point yet gets it exactly once", () => {
    const q = { ...base, sent_at: sentBefore, nudge_day3_at: "x" };
    expect(quoteTimerAction(q, new Date("2026-11-14T01:00:00Z"), CUTOVER)).toBe("nudge_expiry");
    expect(quoteTimerAction({ ...q, nudge_day10_at: "stamped" }, new Date("2026-11-14T01:00:00Z"), CUTOVER)).toBeNull();
  });
  test("day 3 is sent once; a stamped quote is never nudged again; an accepted quote never", () => {
    const q = { ...base, sent_at: sentAfter };
    expect(quoteTimerAction(q, new Date("2026-11-13T02:00:00Z"), CUTOVER)).toBe("nudge_day3");
    expect(quoteTimerAction({ ...q, nudge_day3_at: "x" }, new Date("2026-11-13T02:00:00Z"), CUTOVER)).toBeNull();
    expect(quoteTimerAction({ ...q, status: "accepted" }, new Date("2026-11-13T02:00:00Z"), CUTOVER)).toBeNull();
  });
  test("reminder text keys are the same before and after Part 3 (one send per quote and step)", async () => {
    const { approvedTextKey } = await import("../src/lib/approved-texts.core");
    expect(approvedTextKey.quoteReminder("q1", "day3")).toBe("quote-reminder-text:v1:q1:day3");
    expect(approvedTextKey.quoteReminder("q1", "expiry")).toBe("quote-reminder-text:v1:q1:expiry");
  });
});

describe("acceptance (T12): a quote accepted before ship has no counter-signature event and still renders", () => {
  test("no acceptance_countersigned event on the job -> the reader finds nothing (no error)", async () => {
    world("measured_quote_accepted");
    tables.workflow_events!.push({ job_id: J, event_type: "customer_agreement_signed", details: { quote_id: Q, quote_version: 2 }, created_at: "2026-10-30T00:00:00Z" });
    const { readAcceptanceCountersignature } = await import("../src/lib/acceptance-signature.server");
    expect(await readAcceptanceCountersignature(J, Q, 2)).toBeNull();
  });
  test("the PDF takes the agreement signature's own name and time, never the current time", async () => {
    const { acceptancePdfSignature } = await import("../src/lib/acceptance-signature.core");
    const agreement = { signedAt: "2026-10-30T02:15:00.000Z", signatureName: "Courtney Smith" };
    expect(acceptancePdfSignature(null, agreement)).toEqual(agreement);
  });
  test("Part 1's builder renders the pre-ship acceptance (agreement signature time, no counter-signature record) and the old acceptance page still renders", async () => {
    const { acceptancePdfSignature } = await import("../src/lib/acceptance-signature.core");
    const { signedAcceptancePdfV2, signedAcceptancePdf } = await import("../src/lib/signed-pdf.server");
    const { CUSTOMER_AGREEMENT_V1_3 } = await import("../src/lib/customer-agreement.core");
    const sig = acceptancePdfSignature(null, { signedAt: "2026-10-30T02:15:00.000Z", signatureName: "Courtney Smith" });
    const v2 = await signedAcceptancePdfV2({
      jobNumber: "HV-1234", installerName: "Reinsulate", ownerName: "Courtney Smith", ownerTypedName: sig.signatureName, address: "2A Chatfield Street, Kingsville VIC 3012",
      signedAt: sig.signedAt, validUntil: "Thu 13 Nov 2026", quoteLine: "Bradford Gold R5.0, 120 m², supplied and installed", priceBeforeRebate: 3768, rebate: 1850, yourPrice: 1918, removalM2: null,
      agreement: { version: "1.3", approvedOn: "2 Nov 2026", body: CUSTOMER_AGREEMENT_V1_3, facts: {
        owner_name: "Courtney Smith", address: "2A Chatfield Street, Kingsville VIC 3012", job_number: "HV-1234", installer_name: "Reinsulate", installer_phone: "03 9000 0000", installer_email: "office@reinsulate.example",
        product: "Bradford Gold R5.0", area_m2: "120", price_before_rebate: "$3,768.00", rebate: "$1,850.00", your_price: "$1,918.00", valid_until: "Thu 13 Nov 2026", safety_check: "$349", deposit: "$156.90", rest: "$1,412.10" } },
    });
    expect(v2.bytes.length).toBeGreaterThan(1000);
    const old = await signedAcceptancePdf({ ownerName: "Courtney Smith", address: "2A Chatfield Street, Kingsville", totalIncGst: 1918, signedAt: "2026-10-30T02:15:00.000Z", jobNumber: "HV-1234", items: [{ title: "Quote acceptance", version: "1", text: "I accept." }] });
    expect(old.length).toBeGreaterThan(500);
  });
});
