// Part 4 Task 17: in-flight jobs get exactly ONE version (old or new) of each Part 4 message.
//
// Same shape as tests/new-flow-inflight-p3.test.ts. The brief's seven stages are mapped to the real job stage each stands for
// and to the step whose messages are due there. For every stage x message the REAL sender runs against an in-memory database
// with every Part 4 *_APPROVED flag forced ON (through the sender's deps / flag argument), and the sends are counted:
//   - the message belongs to an EARLIER step: the OLD version was already sent (seeded with the keys the code used before Part
//     4, written out as literals) -> 0 sends;
//   - THIS step: old already sent -> 0; not sent yet -> exactly 1, the NEW version, and a second run adds nothing;
//   - a LATER step: its trigger fires later -> exactly 1 new version, once.
// New-only messages (no old wording: upgrades needed, visit can't go ahead, access person, tenant notice, after-install
// reminders) are seeded as "already sent" with their own keys / recorded days for the 0-send cells.
// The same cells then run with the flags OFF: the old version or (where there is no old wording) nothing — never both.
// Senders are real; only the database, the transports, the PDF/fact readers and the flags are replaced.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

/* ------------------------------------------------------------------ fake world */
const tables: Tables = new Proxy({} as Tables, { get: (t, k: string) => (t[k] ??= []) });
const reset = () => { for (const k of Object.keys(tables)) delete (tables as Record<string, unknown>)[k]; };
type Sent = { channel: "email" | "sms"; purpose: string; key: string; subject?: string; text: string };
let sent: Sent[] = [];
const admin = memoryPostgrest(tables);
let depositPaid = false, installBooked = false;

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Record<string, unknown> = {}) => { tables.workflow_events!.push({ id: `ev${tables.workflow_events!.length + 1}`, job_id, actor_id, event_type, summary, details, created_at: NOW.toISOString() }); },
  WorkflowError: class extends Error {},
}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined, assertCustomerCommsEnabled: async () => undefined }));
mock.module("../src/lib/in-house-suppression.server", () => ({
  readInHouseDispatchState: async (ids: string[]) => ({ failed: false, held: new Set(ids) }),
  inHouseDispatchSkip: async () => null,
}));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/unsubscribe/x" }));
// The guarded sender's real contract: one row per idempotency key (unique index in the database); a second try is "already attempted".
const guardedEmail = async (p: { jobId: string; purpose: string; key: string; build: (u: string | null) => { subject: string; text: string } }) => {
  if (tables.customer_email_sends!.some((r) => r.idempotency_key === p.key)) return "already attempted — not resent";
  tables.customer_email_sends!.push({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key, status: "sent" });
  const m = p.build("https://u");
  sent.push({ channel: "email", purpose: p.purpose, key: p.key, subject: m.subject, text: m.text });
  return "sent";
};
const realSms = async (p: { type: string; idempotencyKey: string; body: string }) => {
  if (tables.sms_messages!.some((r) => r.idempotency_key === p.idempotencyKey)) return { status: "already" as const, detail: "already", sid: null };
  tables.sms_messages!.push({ idempotency_key: p.idempotencyKey, type: p.type });
  sent.push({ channel: "sms", purpose: p.type, key: p.idempotencyKey, text: p.body });
  return { status: "sent" as const, detail: "ok", sid: "s" };
};
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: guardedEmail }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: realSms }));
mock.module("../src/lib/office-email.server", () => ({
  sendOfficeEmail: async (p: { label: string; subject: string; message: string; idempotencyKey?: string }) => { sent.push({ channel: "email", purpose: p.label, key: p.idempotencyKey ?? "", subject: p.subject, text: p.message }); return { status: "sent", detail: "ok" }; },
}));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async () => ({ status: "sent", detail: "TEST" }), sendTestSms: async () => ({ status: "sent", detail: "TEST" }) }));
const realTestCore = { ...(await import("../src/lib/test-send.core")) };
mock.module("../src/lib/test-send.core", () => ({ ...realTestCore, isTestPartner: () => false }));
mock.module("../src/lib/qa-inbox.server", () => ({ qaDeliveryHeld: async () => false }));
const OFFICE = { name: "Reinsulate Pty Ltd", tradingName: "Reinsulate", officePhone: "03 9000 0000", email: "office@reinsulate.example" };
const SPARKS = { name: "Sparks Pty Ltd", tradingName: "Sparks Electrical", officePhone: "03 9000 0002", email: "office@sparks.example" };
mock.module("../src/lib/owner-contact.server", () => ({ businessContactForJob: async (_j: string, role: string) => (role === "electrician" ? SPARKS : OFFICE) }));
// Facts the deposit / clear-to-install senders read through other modules (Part 2 money, clearance, install days, owner link).
mock.module("../src/lib/allocation.server", () => ({ clearanceFacts: async () => ({ piesaOutcome: "pass" }) }));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => ({ clearance: { cleared: true, basis: "initial_piesa" }, deadline: "2026-12-05", booked: installBooked }) }));
mock.module("../src/lib/payments.server", () => ({ jobPaymentView: async () => ({ invoiceId: "i", invoices: { install: { id: "i", xero_invoice_id: "x" } }, plan: { installDepositCents: 15700, balanceCents: 141200 }, steps: [{ key: "install_deposit", state: depositPaid ? "paid" : "due", outstandingCents: depositPaid ? 0 : 15700 }], bank: { configured: true, accountName: "P", bsb: "123456", accountNumber: "12345678" }, reference: "INV-1", stripe: { available: true } }) }));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => "https://estimate.homeinsulationvictoria.com.au/my-job/tok" }));
// All done attachments (Part 1 PDFs): real files are not built here.
const PDF_B64 = Buffer.from("%PDF-1.4 x").toString("base64");
const att = (filename: string) => ({ filename, content: PDF_B64, contentType: "application/pdf" });
mock.module("../src/lib/tax-invoice-pdf.server", () => ({ fileTaxInvoicePdf: async () => ({ path: "J/tax.pdf" }) }));
mock.module("../src/lib/veec-form-pdf.server", () => ({ veecFormPdf: async () => ({ bytes: new TextEncoder().encode("%PDF-1.4 form"), layout: { split: [] } }) }));
mock.module("../src/lib/assignment.server", () => ({ currentAssignment: async () => null, veecPreparation: async () => ({ blockers: [], values: { a: "b" }, missing: [] }) }));
mock.module("../src/lib/product-warranty.server", () => ({
  warrantyDecisionFor: async () => ({ products: ["Bradford Gold R5.0"], buildingClass: null, attach: [{ productName: "Bradford Gold R5.0" }], missing: [] }),
  prepareWarrantyCopies: async () => ({ attachments: [att("Bradford-warranty.pdf")], attached: [{ productName: "Bradford Gold R5.0" }], missing: [] }),
  installedProductsFor: async () => ["Bradford Gold R5.0"],
}));
mock.module("../src/lib/product-instructions.server", () => ({ productInstructionsFor: async () => att("Bradford-Gold-installation-instructions.pdf") }));
mock.module("../src/lib/completion-pack.server", () => ({ recordWarrantyCopyProvided: async () => true }));

const { notifyOwnerBooked, sweepOwnerBookedNotices } = await import("../src/lib/in-house-booking.server");
const { requestInstallDeposit, sweepDepositRequests, notifyInstallerDepositPaid } = await import("../src/lib/deposit-request.server");
const { sweepUpgradesNeeded } = await import("../src/lib/upgrades-needed.server");
const { sendInstallNoAccessNotice } = await import("../src/lib/install-no-access-notice.server");
const { queueVisitCancelledOwnerEmail } = await import("../src/lib/visit-cancelled-owner.server");
const { emailOwnerInstallComplete } = await import("../src/lib/approved-owner-emails.server");
const { sweepAfterInstallReminders, readDoneDays } = await import("../src/lib/after-install-reminders.server");
const { textAccessPersonBooked } = await import("../src/lib/access-person-texts.server");
const { sendTenantNotice } = await import("../src/lib/tenant-notice.server");
const { OWNER_BOOKED_V2_APPROVED } = await import("../src/lib/owner-booked-notice.core");
const { INSTALL_NO_ACCESS_NOTICE_EVENT, installNoAccessKeys } = await import("../src/lib/install-no-access-notice.core");
const { VISIT_CANCELLED_EVENT, visitCancelledKey } = await import("../src/lib/visit-cancelled-owner.core");
const { upgradesNeededKey } = await import("../src/lib/upgrades-needed.core");
const { afterInstallKey } = await import("../src/lib/after-install-reminders.core");
const { accessPersonKey } = await import("../src/lib/access-person-texts.core");
const { tenantNoticeKey, TENANT_NOTICE_SENT_EVENT } = await import("../src/lib/tenant-notice.core");

/* ------------------------------------------------------------------ stages and messages */
// The brief's seven stages -> the real job stage each stands for, and the step number of the messages due there.
const STAGES = [
  { name: "assessment_booking", job: "piesa_and_install_window_pending", step: 1 }, // electrician is booking the PIESA
  { name: "assessment_booked", job: "piesa_scheduled", step: 2 },                   // PIESA booked ("You're booked" + access person)
  { name: "piesa_complete", job: "piesa_complete", step: 3 },                        // result in: clear to install / upgrades needed
  { name: "rectification_required", job: "rectification_required", step: 3 },       // upgrades still to come (same step, other route)
  { name: "installation_scheduling", job: "installation_scheduling", step: 4 },      // deposit reminders / deposit received
  { name: "installation_booked", job: "installation_booked", step: 5 },              // install booked, tenant notice, no access, can't go ahead
  { name: "installation_complete", job: "complete", step: 6 },                       // All done, after-install reminders
] as const;
type Stage = (typeof STAGES)[number];

const J = "j1", BK_PIESA = "bkp", BK_INSTALL = "bki", WORKER = "w1", INVOICE = "i", PIESA_REC = "r1";
const NOW = new Date("2026-11-03T01:00:00Z"); // 12pm Melbourne
const PIESA_START = "2026-11-10T22:00:00.000Z"; // Wed 11 Nov, 9am Melbourne
const INSTALL_START = "2026-11-19T21:00:00.000Z"; // Fri 20 Nov, 8am Melbourne
const INSTALL_DAY = "2026-11-20";
const RENTAL = { rented: true, tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" }, access: { who: "tenant", name: "Tina Lee", mobile: "+61400111222" } };

function world(stage: string) {
  reset(); sent = []; depositPaid = false; installBooked = false;
  tables.owners!.push({ id: "o1", email: "owner@example.com", full_name: "Courtney Smith", phone: "0400000000" });
  tables.properties!.push({ id: "p1", address_line: "2A Chatfield Street", suburb: "Kingsville", postcode: "3012" });
  tables.jobs!.push({ id: J, owner_id: "o1", property_id: "p1", job_number: "HV-1234", source: "website", stage, deleted_at: null, qa_archived_at: null, channel: "hivic_sourced" });
  tables.businesses!.push({ id: "b1", name: OFFICE.name, trading_name: OFFICE.tradingName, phone: OFFICE.officePhone, email: OFFICE.email, in_house: true, onboarding_status: "approved", is_active: true });
  tables.job_assignments!.push({ job_id: J, role: "installer", active: true, business_id: "b1", user_id: "u1" });
  tables.customer_estimate_links!.push({ job_id: J, purpose: "step3_estimate", token: "tok", status: "active", expires_at: "2099-01-01" });
  tables.piesa_records!.push({ id: PIESA_REC, job_id: J, is_current: true, created_at: "2026-11-11T01:00:00Z" });
  tables.workflow_events!.push({ id: "taps", job_id: J, event_type: "quick_taps_answered", created_at: "2026-11-01T00:00:00Z", details: { answers: { rental: RENTAL } } });
}
const piesaBooking = () => { if (!tables.bookings!.some((b) => b.id === BK_PIESA)) tables.bookings!.push({ id: BK_PIESA, job_id: J, kind: "assessment", status: "confirmed", scheduled_start: PIESA_START, created_at: NOW.toISOString() }); };
const installBooking = () => { if (!tables.bookings!.some((b) => b.id === BK_INSTALL)) tables.bookings!.push({ id: BK_INSTALL, job_id: J, kind: "installation", status: "confirmed", scheduled_start: INSTALL_START, created_at: NOW.toISOString() }); };
const depositRequested = (at: string) => { if (!tables.workflow_events!.some((e) => e.event_type === "install_deposit_requested")) tables.workflow_events!.push({ id: "req", job_id: J, event_type: "install_deposit_requested", created_at: at, details: { invoice_id: INVOICE, key: `install-deposit:v1:${INVOICE}` } }); };
let flagsOn = true;

/** The deps the access-person / tenant senders take: real reads over the memory tables, the same transports as above. */
const contactDeps = () => ({
  approved: flagsOn,
  sendSms: realSms as never,
  sendEmail: guardedEmail as never,
  sendTestSms: async () => ({ status: "sent", detail: "TEST" }),
  sendTestEmail: async () => ({ status: "sent", detail: "TEST" }),
  quiet: () => false,
  allowed: async () => undefined,
  recordEvent: async (jobId: string, type: string, details: Record<string, unknown>) => { if (!tables.workflow_events!.some((e) => e.id === details["id"])) tables.workflow_events!.push({ job_id: jobId, event_type: type, details, created_at: NOW.toISOString(), ...details }); },
  recordHeld: async () => undefined,
  whoName: async () => "Vic Sparks",
});
const afterInstallDeps = () => ({
  approved: flagsOn,
  jobs: async () => [{ jobId: J, jobSource: "website", installDay: INSTALL_DAY, veecSigned: false, balancePaid: false, balanceCents: 141200, firstName: "Courtney", ownerEmail: "owner@example.com", ownerPhone: "0400000000", link: "https://estimate.homeinsulationvictoria.com.au/my-job/tok" }],
  doneDays: (id: string) => readDoneDays(id, admin as never),
  record: async (id: string, day: 1 | 3 | 7) => { tables.workflow_events!.push({ job_id: id, event_type: "after_install_reminder", details: { day }, created_at: NOW.toISOString() }); },
  deliver: async (j: { jobId: string; ownerEmail: string }, day: 1 | 3 | 7, build: (u: string | null) => { subject: string; text: string; sms: string }) => {
    const r = await guardedEmail({ jobId: j.jobId, purpose: "after_install_reminder", key: afterInstallKey(j.jobId, day), build: () => build(null) });
    await realSms({ type: "after_install_reminder", idempotencyKey: `${afterInstallKey(j.jobId, day)}:sms`, body: build(null).sms });
    return r;
  },
});
const depositDeps = () => ({
  approved: flagsOn, upgradesApproved: false, v2: flagsOn,
  route: async () => ["clear_to_install" as const],
  inputs: async () => ({ checkedOn: "2026-11-11", electrician: "Sparks Electrical", piesaRecordId: PIESA_REC, signedCopyId: "c", attachments: [att("PIESA.pdf"), att("consent.pdf")] }),
  record: async () => undefined,
  paid: async () => ({ officePhone: "03 9000 0000", balanceCents: 141200, depositCents: 15700, attachments: [att("Receipt.pdf"), att("PIESA.pdf")], receiptAttached: true }),
});
const upgradesDeps = () => ({
  approved: flagsOn,
  // The real candidate rule minus the stage join: current PIESA records with no owner delivery yet.
  candidates: async () => (tables.piesa_deliveries!.some((d) => d.recipient === "owner" && d.piesa_record_id === PIESA_REC) ? [] : [J]),
  route: async () => ["upgrades_needed" as const],
  facts: async () => ({ jobSource: "website", piesaRecordId: PIESA_REC, signedCopyId: "c", resultAt: "2026-11-11T01:00:00Z", ownerEmail: "owner@example.com", ownerPhone: "0400000000", firstName: "Courtney", found: ["Old wiring near the manhole"], electrician: SPARKS, installer: "Reinsulate", installBy: "2026-12-11", depositCents: 15700, confirmUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok?screen=clear", attachments: [att("PIESA.pdf")] }),
  record: async (p: { piesaRecordId: string; recipient: string }) => { tables.piesa_deliveries!.push({ piesa_record_id: p.piesaRecordId, recipient: p.recipient }); },
});
const bookedDeps = (kind: "piesa" | "install") => ({ v2Approved: { ...OWNER_BOOKED_V2_APPROVED, [kind]: flagsOn }, electrician: async () => SPARKS, balanceCents: async () => 141200 });

type Msg = {
  id: string; step: number;
  /** What the code left behind when it sent the OLD version (literal keys from before Part 4, base 988fdbf); for a new-only message, its own keys. */
  seedOld: () => void;
  /** Make the trigger fire and run the real sender (twice: a sweep must never double up). `advance` = the job reaches this step. */
  fire: (advance: boolean) => Promise<void>;
  /** True only for the NEW wording. */
  isNew: (s: Sent) => boolean;
  /** When only one channel changes wording, the other channel is not checked for old/new. */
  wordingChannel?: "email" | "sms";
  mine: (s: Sent) => boolean;
  /** Flags OFF and nothing sent before: the old wording goes ("old"), or nothing because there is no old wording ("nothing"). */
  whenOff: "old" | "nothing";
};
const MESSAGES: Msg[] = [
  {
    id: "booked_piesa", step: 2, whenOff: "old",
    seedOld: () => { piesaBooking(); tables.customer_email_sends!.push({ job_id: J, purpose: "in_house_booked", idempotency_key: `in-house-booked:v1:${BK_PIESA}:${WORKER}`, status: "sent" }); tables.sms_messages!.push({ idempotency_key: `in-house-booked:v1:${BK_PIESA}:${WORKER}:sms`, type: "in_house_booked_owner" }); },
    fire: async () => { piesaBooking(); await notifyOwnerBooked(J, "piesa", PIESA_START, { id: WORKER, name: "Vic Sparks", phone: "0422222222" }, NOW, bookedDeps("piesa")); await sweepOwnerBookedNotices(NOW, bookedDeps("piesa")); },
    // old wording names the worker's phone and "Details in your email"; the new one never shows a worker's number
    isNew: (s) => !/0422222222|Details in your email/.test(s.text),
    mine: (s) => s.purpose === "in_house_booked" || s.purpose === "in_house_booked_owner",
  },
  {
    id: "access_person_booked_piesa", step: 2, whenOff: "nothing",
    seedOld: () => { piesaBooking(); tables.sms_messages!.push({ idempotency_key: accessPersonKey.booked(BK_PIESA, "+61400111222"), type: "access_person_booked" }); },
    fire: async () => { piesaBooking(); await textAccessPersonBooked(J, BK_PIESA, NOW, contactDeps() as never); await textAccessPersonBooked(J, BK_PIESA, NOW, contactDeps() as never); },
    isNew: (s) => /at 2A Chatfield Street is booked for Wed 11 Nov, 9:00am/.test(s.text),
    mine: (s) => s.purpose === "access_person_booked",
  },
  {
    id: "clear_to_install", step: 3, whenOff: "old",
    seedOld: () => { tables.customer_email_sends!.push({ job_id: J, purpose: "install_deposit_request", idempotency_key: `install-deposit:v1:${INVOICE}`, status: "sent" }); tables.sms_messages!.push({ idempotency_key: `install-deposit:v1:${INVOICE}:sms`, type: "install_deposit_request" }); depositRequested("2026-11-02T00:00:00Z"); },
    fire: async () => { await requestInstallDeposit(J, NOW, depositDeps()); await requestInstallDeposit(J, NOW, depositDeps()); },
    isNew: (s) => s.channel === "sms" || /You're clear to install/.test(s.subject ?? ""),
    wordingChannel: "email",
    mine: (s) => s.purpose === "piesa_copy" || s.purpose === "install_deposit_request",
  },
  {
    id: "upgrades_needed", step: 3, whenOff: "nothing",
    // the OLD message for this step is the standalone signed PIESA copy: its owner delivery row makes the job no candidate
    seedOld: () => { tables.piesa_deliveries!.push({ piesa_record_id: PIESA_REC, recipient: "owner" }); tables.customer_email_sends!.push({ job_id: J, purpose: "piesa_copy", idempotency_key: `piesa-copy:v1:${PIESA_REC}:owner`, status: "sent" }); },
    fire: async () => { await sweepUpgradesNeeded(NOW, upgradesDeps() as never); await sweepUpgradesNeeded(NOW, upgradesDeps() as never); },
    isNew: (s) => /electrical upgrades needed/.test(`${s.subject ?? ""} ${s.text}`),
    mine: (s) => s.key.startsWith(upgradesNeededKey(PIESA_REC)),
  },
  {
    id: "deposit_reminder_day3", step: 4, whenOff: "old",
    seedOld: () => { depositRequested("2026-10-30T00:00:00Z"); tables.customer_email_sends!.push({ job_id: J, purpose: "install_deposit_day3", idempotency_key: `install-deposit-day3:v1:${INVOICE}`, status: "sent" }); tables.sms_messages!.push({ idempotency_key: `install-deposit-day3:v1:${INVOICE}:sms`, type: "install_deposit_reminder" }); },
    fire: async (advance) => { depositRequested("2026-10-30T00:00:00Z"); if (advance) tables.jobs![0]!.stage = "installation_scheduling"; await sweepDepositRequests(NOW, depositDeps()); await sweepDepositRequests(NOW, depositDeps()); },
    isNew: (s) => /Reminder: one last step to book your install/.test(s.subject ?? "") || (s.channel === "sms" && /clear/.test(s.text)),
    wordingChannel: "email",
    mine: (s) => s.purpose === "install_deposit_day3" || s.key.startsWith(`install-deposit-day3:v1:${INVOICE}`),
  },
  {
    id: "deposit_paid", step: 4, whenOff: "old",
    seedOld: () => { tables.customer_email_sends!.push({ job_id: J, purpose: "install_deposit_paid", idempotency_key: `install-deposit-paid:v1:${INVOICE}`, status: "sent" }, { job_id: J, purpose: "install_deposit_paid_office", idempotency_key: `install-deposit-paid-office:v1:${INVOICE}`, status: "sent" }); },
    fire: async () => { depositPaid = true; tables.workflow_events!.push({ id: "rcv", job_id: J, event_type: "install_deposit_received", created_at: NOW.toISOString(), details: { invoice_id: INVOICE } }); await notifyInstallerDepositPaid(J, NOW, depositDeps()); await notifyInstallerDepositPaid(J, NOW, depositDeps()); },
    isNew: (s) => /Deposit received, thanks!|deposit in, ready to book/.test(s.subject ?? ""),
    mine: (s) => s.purpose === "install_deposit_paid" || s.purpose === "install_deposit_paid_office",
  },
  {
    id: "booked_install", step: 5, whenOff: "old",
    seedOld: () => { installBooking(); tables.customer_email_sends!.push({ job_id: J, purpose: "in_house_booked", idempotency_key: `in-house-booked:v1:${BK_INSTALL}:${WORKER}`, status: "sent" }); tables.sms_messages!.push({ idempotency_key: `in-house-booked:v1:${BK_INSTALL}:${WORKER}:sms`, type: "in_house_booked_owner" }); },
    fire: async () => { installBooking(); await notifyOwnerBooked(J, "install", INSTALL_START, { id: WORKER, name: "Sam Lead", phone: "0422222222" }, NOW, bookedDeps("install")); await sweepOwnerBookedNotices(NOW, bookedDeps("install")); },
    isNew: (s) => !/0422222222|Details in your email/.test(s.text),
    mine: (s) => s.purpose === "in_house_booked" || s.purpose === "in_house_booked_owner",
  },
  {
    id: "tenant_notice", step: 5, whenOff: "nothing",
    seedOld: () => { installBooking(); tables.sms_messages!.push({ idempotency_key: tenantNoticeKey(BK_INSTALL, "sms"), type: "tenant_notice" }); tables.customer_email_sends!.push({ job_id: J, purpose: "tenant_notice", idempotency_key: tenantNoticeKey(BK_INSTALL, "email"), status: "sent" }); },
    fire: async () => { installBooking(); await sendTenantNotice(J, BK_INSTALL, NOW, contactDeps() as never); await sendTenantNotice(J, BK_INSTALL, NOW, contactDeps() as never); },
    isNew: (s) => /power will be off for the day/.test(s.text),
    mine: (s) => s.purpose === "tenant_notice",
  },
  {
    id: "no_access", step: 5, whenOff: "old",
    seedOld: () => { installBooking(); tables.workflow_events!.push({ id: "na", job_id: J, event_type: INSTALL_NO_ACCESS_NOTICE_EVENT, created_at: NOW.toISOString(), details: { booking_id: BK_INSTALL } }); tables.customer_email_sends!.push({ job_id: J, purpose: "install_no_access", idempotency_key: installNoAccessKeys(BK_INSTALL).email, status: "sent" }); tables.sms_messages!.push({ idempotency_key: installNoAccessKeys(BK_INSTALL).sms, type: "install_no_access" }); },
    fire: async () => { installBooking(); const p = { jobId: J, bookingId: BK_INSTALL, wasStart: INSTALL_START, reason: "nobody home", reportedAt: NOW.toISOString() }; const d = { v2: flagsOn, approved: true }; await sendInstallNoAccessNotice(p, d); await sendInstallNoAccessNotice(p, d); },
    isNew: (s) => /will call you from 03 9000 0000/.test(s.text),
    mine: (s) => s.purpose === "install_no_access",
  },
  {
    id: "visit_cancelled", step: 5, whenOff: "nothing",
    seedOld: () => { installBooking(); tables.workflow_events!.push({ id: "vc", job_id: J, event_type: VISIT_CANCELLED_EVENT, created_at: NOW.toISOString(), details: { booking_id: BK_INSTALL } }); tables.customer_email_sends!.push({ job_id: J, purpose: "visit_cant_go_ahead", idempotency_key: visitCancelledKey(BK_INSTALL), status: "sent" }); },
    fire: async () => { installBooking(); await queueVisitCancelledOwnerEmail(J, BK_INSTALL, "installer", { approved: flagsOn }); await queueVisitCancelledOwnerEmail(J, BK_INSTALL, "installer", { approved: flagsOn }); },
    isNew: (s) => /can't go ahead/.test(s.text),
    mine: (s) => s.purpose === "visit_cant_go_ahead",
  },
  {
    id: "all_done", step: 6, whenOff: "old",
    seedOld: () => { tables.customer_email_sends!.push({ job_id: J, purpose: "install_complete", idempotency_key: `install-complete:v1:${J}`, status: "sent" }); },
    fire: async () => { const i = { product: "Bradford Gold R5.0", areaM2: 120, rebate: 2380, balancePaid: false, balanceCents: 141200, signRebateFormUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok?screen=done" }; await emailOwnerInstallComplete(J, i, { v2: flagsOn }); await emailOwnerInstallComplete(J, i, { v2: flagsOn }); },
    isNew: (s) => /All done, Courtney/.test(s.subject ?? "") && !/Certificate of Completion/.test(s.text),
    mine: (s) => s.purpose === "install_complete",
  },
  {
    id: "after_install_day1", step: 6, whenOff: "nothing",
    // the OLD day-1 reminder was the rebate-form reminder O61 (veec_sign_reminder step reminder_1): readDoneDays counts it
    seedOld: () => { tables.workflow_events!.push({ id: "o61", job_id: J, event_type: "veec_sign_reminder", created_at: "2026-11-21T02:00:00Z", details: { step: "reminder_1" } }); },
    fire: async () => { const day1 = new Date("2026-11-21T02:00:00Z"); await sweepAfterInstallReminders(day1, afterInstallDeps() as never); await sweepAfterInstallReminders(day1, afterInstallDeps() as never); },
    isNew: (s) => /things? left/.test(s.text),
    mine: (s) => s.purpose === "after_install_reminder",
  },
];

/** The relation of a message's step to the stage the job is in. */
const rel = (stage: Stage, m: Msg) => (m.step < stage.step ? "past" : m.step === stage.step ? "this" : "later");
const emails = (xs: Sent[]) => xs.filter((s) => s.channel === "email");
const ownerEmails = (m: Msg, xs: Sent[]) => emails(xs).filter((s) => s.purpose !== "install_deposit_paid_office" && m.mine(s));
const noOld = (m: Msg) => m.whenOff === "nothing";

describe("matrix: every Part 4 flag ON", () => {
  beforeEach(() => { flagsOn = true; });
  for (const stage of STAGES) {
    for (const m of MESSAGES) {
      const r = rel(stage, m);
      if (r === "past" || r === "this") {
        test(`${stage.name} x ${m.id} [${r === "past" ? "past this step" : "this step"}, ${noOld(m) ? "already sent" : "old version already sent"}] -> nothing new`, async () => {
          world(stage.job); m.seedOld();
          await m.fire(false);
          expect(sent.filter(m.mine)).toEqual([]);
        });
      }
      if (r === "this" || r === "later") {
        test(`${stage.name} x ${m.id} [${r === "this" ? "this step, nothing sent yet" : "later step"}] -> exactly one, the new version, once`, async () => {
          world(stage.job);
          await m.fire(r === "later");
          const mine = sent.filter(m.mine);
          expect({ id: m.id, emails: ownerEmails(m, mine).length }).toEqual({ id: m.id, emails: m.id === "access_person_booked_piesa" ? 0 : 1 });
          if (m.id === "access_person_booked_piesa") expect(mine.filter((s) => s.channel === "sms")).toHaveLength(1);
          for (const s of mine.filter((x) => !m.wordingChannel || x.channel === m.wordingChannel)) expect({ id: m.id, key: s.key, isNew: m.isNew(s) }).toEqual({ id: m.id, key: s.key, isNew: true });
          const n = sent.length; await m.fire(r === "later"); expect(sent.length).toBe(n); // a second run adds nothing
        });
      }
    }
  }
});

describe("matrix: every Part 4 flag OFF - the old version (or nothing where there is no old wording), never both", () => {
  beforeEach(() => { flagsOn = false; });
  for (const m of MESSAGES) {
    test(`${m.id}: nothing sent yet -> ${m.whenOff === "old" ? "old version once" : "nothing"}, never the new wording`, async () => {
      world("installation_scheduling");
      await m.fire(true);
      const mine = sent.filter(m.mine);
      for (const s of mine.filter((x) => !m.wordingChannel || x.channel === m.wordingChannel)) expect({ id: m.id, key: s.key, isNew: m.isNew(s) }).toEqual({ id: m.id, key: s.key, isNew: false });
      if (m.whenOff === "nothing") expect(mine).toHaveLength(0);
      else expect(mine.length).toBeGreaterThan(0);
      const n = sent.length; await m.fire(true); expect(sent.length).toBe(n);
    });
    test(`${m.id}: already sent -> nothing`, async () => {
      world("installation_scheduling"); m.seedOld();
      await m.fire(true);
      expect(sent.filter(m.mine)).toEqual([]);
    });
  }
});

describe("flag flipped part-way through: still one version per booking / invoice / job", () => {
  for (const id of ["booked_piesa", "booked_install", "clear_to_install", "deposit_paid", "no_access", "all_done"]) {
    const m = MESSAGES.find((x) => x.id === id)!;
    test(`${id}: the old version went with the flag off -> nothing more when the flag goes on`, async () => {
      flagsOn = false; world("installation_scheduling");
      await m.fire(true);
      const first = sent.filter(m.mine).length;
      expect(first).toBeGreaterThan(0);
      flagsOn = true;
      await m.fire(true);
      expect(sent.filter(m.mine)).toHaveLength(first);
    });
  }
  test("tenant notice: a changed install time is a new booking -> one more notice, the old booking never again", async () => {
    flagsOn = true; world("installation_booked");
    const m = MESSAGES.find((x) => x.id === "tenant_notice")!;
    await m.fire(true);
    tables.bookings!.find((b) => b.id === BK_INSTALL)!.status = "cancelled";
    tables.bookings!.push({ id: "bki2", job_id: J, kind: "installation", status: "confirmed", scheduled_start: "2026-11-23T22:00:00.000Z", created_at: NOW.toISOString() });
    await sendTenantNotice(J, "bki2", NOW, contactDeps() as never);
    await sendTenantNotice(J, BK_INSTALL, NOW, contactDeps() as never);
    expect(sent.filter(m.mine).map((s) => s.key).sort()).toEqual([tenantNoticeKey(BK_INSTALL, "email"), tenantNoticeKey(BK_INSTALL, "sms"), tenantNoticeKey("bki2", "email"), tenantNoticeKey("bki2", "sms")].sort());
    expect(tables.workflow_events!.filter((e) => e.event_type === TENANT_NOTICE_SENT_EVENT)).toHaveLength(2);
  });
  test("after-install reminders: a job that had the old day-1 rebate reminder gets day 3 once and never day 1", async () => {
    flagsOn = true; world("complete");
    tables.workflow_events!.push({ id: "o61", job_id: J, event_type: "veec_sign_reminder", created_at: "2026-11-21T02:00:00Z", details: { step: "reminder_1" } });
    const day3 = new Date("2026-11-23T02:00:00Z");
    await sweepAfterInstallReminders(day3, afterInstallDeps() as never);
    await sweepAfterInstallReminders(day3, afterInstallDeps() as never);
    expect(sent.filter((s) => s.purpose === "after_install_reminder").map((s) => s.key)).toEqual([afterInstallKey(J, 3), `${afterInstallKey(J, 3)}:sms`]);
  });
});

/* ------------------------------------------------------------------ confirm-and-pay page (Task 5) in-flight cases, pure */
describe("confirm-and-pay page: in-flight owners see done steps and sign only what is left", async () => {
  const { confirmSignPayBlockers, clearScreenOpen, clearAction, stepsUnsigned, consentOnlyOpen, withNoDeposit } = await import("../src/lib/confirm-sign-pay.core");
  const { resolveOwnerScreen } = await import("../src/lib/owner-myjob.core");
  const ALL: [boolean, boolean, boolean, boolean] = [true, true, true, true];
  const NONE: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  const state = (o: { piesa?: boolean; consent?: boolean; paid?: boolean } = {}) => ({
    piesa: { checkedOn: "2026-11-11", electrician: "Sparks Electrical", result: "Safe to insulate" as const, done: o.piesa === true },
    consent: { name: "Courtney Smith", address: "2A Chatfield Street", phone: "0400000000", email: "owner@example.com", done: o.consent === true, signedOn: o.consent ? "2026-11-01" : null },
    deposit: { amountCents: 15700, paid: o.paid === true },
  });
  test("consent signed at acceptance (old flow) + PIESA confirmed on the old page -> nothing to tick or sign", () => {
    expect(confirmSignPayBlockers({ piesaTick: false, consentTicks: NONE, typedName: "", state: state({ piesa: true, consent: true }) })).toEqual([]);
    expect(stepsUnsigned(state({ piesa: true, consent: true }))).toBe(false);
  });
  test("only the missing step needs its tick + a full name", () => {
    expect(confirmSignPayBlockers({ piesaTick: false, consentTicks: ALL, typedName: "Courtney Smith", state: state({ piesa: true }) })).toEqual([]);
    expect(confirmSignPayBlockers({ piesaTick: true, consentTicks: NONE, typedName: "Courtney Smith", state: state({ consent: true }) })).toEqual([]);
    expect(confirmSignPayBlockers({ piesaTick: true, consentTicks: NONE, typedName: "Courtney", state: state({ consent: true }) }).length).toBe(1);
  });
  test("the page opens straight after the PIESA result (also with upgrades to come) and stays open while a step is unsigned, even once the deposit is paid", () => {
    const f = { stage: "piesa_complete", outcome: "all_clear" as const, safetyCleared: true, depositCleared: false, depositCents: 15700 };
    expect(clearScreenOpen(f)).toBe(true);
    expect(clearScreenOpen({ ...f, outcome: "upgrades_needed" })).toBe(true);
    expect(clearScreenOpen({ ...f, depositCleared: true, unsigned: true })).toBe(true);
    expect(clearScreenOpen({ ...f, depositCleared: true, unsigned: false })).toBe(false);
  });
  test("old ?screen=pay / ?screen=piesa links land on the clear page while a step is unsigned; a job with no page state keeps the old screens", () => {
    expect(resolveOwnerScreen("pay", { currentAction: "clear", clearStepsUnsigned: true })).toBe("clear");
    expect(resolveOwnerScreen("piesa", { currentAction: "clear", clearStepsUnsigned: true })).toBe("clear");
    expect(resolveOwnerScreen("pay", { currentAction: "clear", clearStepsUnsigned: false })).toBe("pay");
    expect(clearAction(true, null)).toBeNull();
  });
  test("consent awaiting the owner with no deposit to pay (deposit 0 / state load failed) -> consent-only page, no deposit step", () => {
    expect(consentOnlyOpen({ clearOpen: false, consentAwaitingOwner: true })).toBe(true);
    expect(consentOnlyOpen({ clearOpen: true, consentAwaitingOwner: true })).toBe(false);
    expect(withNoDeposit(state()).deposit).toEqual({ amountCents: 0, paid: false });
  });
});
