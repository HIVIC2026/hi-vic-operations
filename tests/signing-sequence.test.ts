// Corrected Activity 48 sequence: agreement ≠ ESC consent ≠ final VEEC assignment. Pure rules + source checks, no network.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { apConsentBlockers, buildConsentFacts, consentStaleReasons, consentValidityBlockers, ownerConsentBlockers, ESC_AP_LEGAL_NAME } from "../src/lib/consent.core";
import { buildEscPayload, readyToInstall, sendTimingBlocker, submissionBlockers } from "../src/lib/esc.core";
import { buildFinalFacts, finalAssignmentAvailability, type Template } from "../src/lib/assignment.core";

const start = "2026-10-10T00:00:00.000Z";
const T = (k: string): Template => ({ template_key: k, version: "v1", body: "x".repeat(30), approved: true, is_active: true, required: true });
const owner = { name: "Jo", email: "jo@x.au", phone: null };
const facts = buildConsentFacts({ scheduledStart: start, scheduledEnd: null, premisesAddress: "1 St VIC", owner })!;
const valid = { status: "valid", scheduled_start: start, owner_signed_at: "2026-10-02T00:00:00.000Z", ap_signed_at: "2026-10-02T01:00:00.000Z" };
const input = { signatoryName: "Jo", authorityType: "owner" as const, accept: true, signatureName: "Jo Citizen" };

describe("quote acceptance is commercial; VEEC assignment is post-install", () => {
  const src = readFileSync("src/lib/assignment.server.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function signCustomerAgreement"), src.indexOf("// ---------- Installer declaration"));
  const prepare = src.slice(src.indexOf("export async function prepareFinalAssignment"), src.indexOf("export async function signFinalAssignment"));
  const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
  const respond = pf.slice(pf.indexOf("export const respondToQuote"), pf.indexOf("// ---------- Payments"));
  test("records only the commercial agreement at quote acceptance", () => {
    expect(fn).toContain('from("customer_agreements")');
    expect(fn).not.toContain("signConditionalAssignment");
    expect(fn).not.toContain('from("customer_assignments")');
    expect(fn).not.toMatch(/owner_esc_consents|esc_consent/);
    expect(respond).not.toMatch(/owner_esc_consents|signFinalAssignment|signOwnerConsent/);
  });
  test("prepares a new official assignment after installation with final facts", () => {
    expect(prepare).toContain('status: "awaiting_installer_signature"');
    expect(prepare).toContain("final_facts");
    expect(prepare).toContain('signed_stage === "quote_stage_conditional"');
    expect(prepare).toContain("LEGACY_CONDITIONAL_ASSIGNMENT_RETIRED");
  });
  test("still creates the Xero invoice (existing flow) after signing", () => {
    expect(respond.indexOf("signCustomerAgreement")).toBeLessThan(respond.indexOf("createInvoiceAfterAcceptance"));
  });
  test("payment code never mutates assignment records", () => {
    const x = readFileSync("src/lib/xero.server.ts", "utf8") + readFileSync("src/lib/invoice.lifecycle.ts", "utf8");
    expect(x).not.toMatch(/customer_assignments/);
  });
});

describe("owner ESC consent", () => {
  test("cannot be generated or signed before an exact installation date", () => {
    expect(buildConsentFacts({ scheduledStart: null, scheduledEnd: null, premisesAddress: "A", owner })).toBeNull();
    expect(ownerConsentBlockers({ status: null, templateApproved: true, scheduledStart: null, nowIso: "2026-10-01T00:00:00Z", input })[0]).toMatch(/exact installation date/);
  });
  test("prefills AP legal name and exact day", () => {
    expect(facts.ap_legal_entity).toBe(ESC_AP_LEGAL_NAME);
    expect(facts.installation_days).toEqual(["2026-10-10"]);
  });
  test("unapproved template fails closed; <24h signing rejected; AP must confirm after owner", () => {
    expect(ownerConsentBlockers({ status: "awaiting_owner", templateApproved: false, scheduledStart: start, nowIso: "2026-10-01T00:00:00Z", input }).join()).toMatch(/not been approved/);
    expect(ownerConsentBlockers({ status: "awaiting_owner", templateApproved: true, scheduledStart: start, nowIso: "2026-10-09T06:00:00Z", input }).join()).toMatch(/24 hours/);
    expect(ownerConsentBlockers({ status: "awaiting_owner", templateApproved: true, scheduledStart: start, nowIso: "2026-10-01T00:00:00Z", input })).toEqual([]);
    expect(apConsentBlockers({ status: "awaiting_owner", scheduledStart: start, nowIso: "2026-10-01T00:00:00Z", apRepName: "Al", purposeExplained: true })[0]).toMatch(/owner must sign first/);
    expect(apConsentBlockers({ status: "awaiting_ap", scheduledStart: start, nowIso: "2026-10-01T00:00:00Z", apRepName: "Al", purposeExplained: false }).join()).toMatch(/purpose/);
  });
  test("stale on date / address / owner identity / contact change", () => {
    expect(consentStaleReasons(facts, { ...facts, scheduled_start: "2026-10-12T00:00:00.000Z" })).toContain("installation date/time changed");
    expect(consentStaleReasons(facts, { ...facts, premises_address: "2 St" })).toContain("premises address changed");
    expect(consentStaleReasons(facts, { ...facts, owner: { ...owner, name: "Sam" } })).toContain("owner identity changed");
    expect(consentStaleReasons(facts, { ...facts, owner: { ...owner, phone: "0400" } })).toContain("owner contact details changed");
    expect(consentValidityBlockers(valid, "2026-10-12T00:00:00.000Z").join()).toMatch(/stale/);
  });
});

describe("ESC notification", () => {
  test("blocked without valid separate consent", () => {
    const cfg = { version: "g", required_fields: [], approved: true, is_active: true };
    const i = { jobNumber: "HV-1", installationDays: ["2026-10-10"], scheduledStart: start, scheduledEnd: null, premisesAddress: "A", owner, extra: {} };
    expect(buildEscPayload(cfg, { ...i, consentReference: null }).status).toBe("not_ready");
    expect(buildEscPayload(cfg, { ...i, consentReference: "c:1" }).status).toBe("ready");
    expect(submissionBlockers({ consent: null, scheduledStart: start, sentAt: "2026-10-07T00:00:00Z" }).join()).toMatch(/consent/);
    expect(submissionBlockers({ consent: { ...valid, status: "awaiting_ap", ap_signed_at: null }, scheduledStart: start, sentAt: "2026-10-07T00:00:00Z" }).length).toBeGreaterThan(0);
    expect(submissionBlockers({ consent: valid, scheduledStart: start, sentAt: "2026-10-07T00:00:00Z" })).toEqual([]);
  });
  test("5-day earliest / 24-hour latest", () => {
    expect(sendTimingBlocker("2026-10-04T23:00:00Z", start)).toMatch(/too early/);
    expect(sendTimingBlocker("2026-10-05T00:00:00Z", start)).toBeNull();
    expect(sendTimingBlocker("2026-10-09T00:00:00Z", start)).toBeNull();
    expect(sendTimingBlocker("2026-10-09T01:00:00Z", start)).toMatch(/less than 24h/);
  });
  test("conditional fields only required when their condition applies", () => {
    const cfg = { version: "g", required_fields: [{ key: "coes_number", label: "CoES number", when: "rectification" as const }], approved: true, is_active: true };
    const i = { jobNumber: "HV-1", installationDays: ["x"], scheduledStart: start, scheduledEnd: null, premisesAddress: "A", owner, extra: {}, consentReference: "c" };
    expect(buildEscPayload(cfg, { ...i, conditions: { rectification: false, recRequired: false } }).status).toBe("ready");
    expect(buildEscPayload(cfg, { ...i, conditions: { rectification: true, recRequired: true } }).missing).toContain("CoES number");
  });
  test("notification sent before consent completed => not ready to install", () => {
    const r = readyToInstall({ scheduledStart: start, consent: { ...valid, owner_signed_at: "2026-10-07T00:00:00Z", ap_signed_at: "2026-10-07T00:00:00Z" }, notification: { status: "sent", sent_at: "2026-10-06T00:00:00Z", submission_reference: "E1", scheduled_start: start }, deliveries: { owner: "2026-10-05T00:00:00Z", installer: "2026-10-05T00:00:00Z" }, piesa: { date: "2026-09-20", deadline: "2026-10-20", outcome: "pass" } });
    expect(r.blockers.join()).toMatch(/before valid owner consent/);
  });
});

describe("final assignment availability + snapshot", () => {
  const tpls = [T("consumer_declaration")];
  test("unavailable before install or agreement; no AP-review / separate declaration prerequisite (decision 119)", () => {
    expect(finalAssignmentAvailability({ installationCompleted: false, agreementSigned: false, templates: tpls }).length).toBe(2);
    expect(finalAssignmentAvailability({ installationCompleted: false, agreementSigned: true, templates: tpls })).toEqual(["Installation not yet recorded as complete"]);
    expect(finalAssignmentAvailability({ installationCompleted: true, agreementSigned: true, templates: [] })[0]).toMatch(/official ESC VEEC assignment form v1\.1/);
    expect(finalAssignmentAvailability({ installationCompleted: true, agreementSigned: true, templates: tpls })).toEqual([]);
  });
  test("snapshot carries final product / R-value / area / price / payment", () => {
    const f = buildFinalFacts({ job_number: "HV-1", ap_legal_entity: "AP", property_address: "A", completed_date: "2026-10-10", installed: [{ product: "Batts", r_value: "R5.0", area_m2: 80 }, { product: "Batts", r_value: "R4.0", area_m2: 20.5 }], zones: [],
      installer: { user_id: "u", name: "I", business: "B", abn: "1", licence: null }, consumer: { name: "Jo", email: null, phone: null }, final_customer_price_inc_gst: 1200, veu_benefit_inc_gst: 800, price_before_benefit_inc_gst: 2000,
      payment: { status: "fully_paid", reference: "INV-1", amount_paid: 1200 }, template_version: "v1", form_values: {} });
    expect(f).toMatchObject({ total_installed_area_m2: 100.5, co_payment_inc_gst: 1200, payment: { reference: "INV-1" } });
    expect(f.installed[0]!.r_value).toBe("R5.0");
    expect(JSON.stringify(f)).not.toMatch(/terms|cooling|warranty/i); // no commercial T&Cs in official facts
  });
});

describe("communications lock", () => {
  test("final copy and consent copy delivery depend on the global lock then owner consent (default locked)", () => {
    const a = readFileSync("src/lib/assignment.server.ts", "utf8"), c = readFileSync("src/lib/consent.server.ts", "utf8");
    for (const s of [a, c]) { expect(s).toContain("customerDeliveryState"); expect(s).not.toMatch(/sendEmail|twilio|resend/i); }
    expect(readFileSync("src/lib/comms.server.ts", "utf8")).toContain(`if (!(await customerCommsEnabled())) return "pending_comms_lock";`);
  });
});
