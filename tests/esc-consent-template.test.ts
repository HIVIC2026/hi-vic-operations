// Decision 123 (Jo, 24 Oct 2026): the owner's ESC information-sharing consent uses the ESC Owner's Consent Form Template
// v1 verbatim. Pure rules: Section 1 prefill, four Section 2 ticks, AP Part A/B, rendering, legacy {dates}, timing kept.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  apConsentBlockers, apDeclarationText, apRepFullName, allDeclarationsTicked, buildConsentFacts, consentValidityBlockers, ESC_AP_FULL_NAME,
  ESC_CONSENT_TEMPLATE_VERSION, isEscTemplateVersion, latestConsentAt, OWNER_DECLARATIONS, ownerConsentBlockers, ownerDeclarationBlockers,
  renderConsentBody, section1FromFacts, splitFullName, type ApRep,
} from "../src/lib/consent.core";
import { CONSENT_COPY_EMAIL_APPROVED, renderConsentCopyEmail } from "../src/lib/consent-copy-email.core";

const start = "2026-11-10T22:00:00.000Z"; // 11 Nov 2026 09:00 Melbourne
const facts = buildConsentFacts({ scheduledStart: start, scheduledEnd: null, premisesAddress: "12 Sample St, Reservoir VIC 3073", owner: { name: "Mary Anne Citizen", email: "mary@example.com", phone: "0400 000 000" } })!;
const all = { owner_or_authorised: true, details_accurate: true, consent_ap_sends: true, consent_commission_shares: true };
const input = { signatoryName: "Mary Anne Citizen", authorityType: "owner" as const, accept: true, signatureName: "Mary Anne Citizen", declarations: all };
const rep: ApRep = { first_name: "Jo", last_name: "Lowe", role: "Director", phone: "03 9000 0000", email: "jo@homeinsulationvictoria.com.au" };
const now = "2026-11-01T00:00:00.000Z";
const esc = ESC_CONSENT_TEMPLATE_VERSION;

describe("Section 1 prefill from owner + property", () => {
  test("splits the owner's full name into first and last", () => {
    expect(splitFullName("Mary Anne Citizen")).toEqual({ first: "Mary Anne", last: "Citizen" });
    expect(splitFullName("Cher")).toEqual({ first: "Cher", last: "" });
    expect(splitFullName("  ")).toEqual({ first: "", last: "" });
    expect(splitFullName(null)).toEqual({ first: "", last: "" });
  });
  test("prefills the five Section 1 fields; the owner never retypes them", () => {
    expect(section1FromFacts(facts)).toEqual({ first_name: "Mary Anne", last_name: "Citizen", installation_address: "12 Sample St, Reservoir VIC 3073", phone: "0400 000 000", email: "mary@example.com" });
  });
});

describe("Section 2: the four declaration lines must each be ticked", () => {
  test("the lines are the ESC template's, with the AP name in the ESC placeholder", () => {
    expect(OWNER_DECLARATIONS.map((d) => d.text)).toEqual([
      "I am the owner of the property listed above, or I am authorised to provide consent on behalf of the owner.",
      "the details listed above are complete and accurate.",
      `I consent to ${ESC_AP_FULL_NAME} sending the information set out in section 1 of this form to the Essential Services Commission (commission)`,
      "I consent to the commission sharing the information set out in section 1 of this form with the Victorian WorkCover Authority (WorkSafe) and/or Energy Safe Victoria (ESV)",
    ]);
    expect(ESC_AP_FULL_NAME).toBe("DC Construction Solutions Pty Ltd trading as Home Insulation Victoria (VEU Accredited Person A003654)");
  });
  test("one blocker per unticked line; none when all four are ticked", () => {
    expect(ownerDeclarationBlockers(all)).toEqual([]);
    expect(allDeclarationsTicked(all)).toBe(true);
    const three = ownerDeclarationBlockers({ ...all, consent_commission_shares: false });
    expect(three).toHaveLength(1);
    expect(three[0]).toContain("WorkSafe");
    expect(ownerDeclarationBlockers(undefined)).toHaveLength(4);
    expect(allDeclarationsTicked({ ...all, details_accurate: undefined })).toBe(false);
  });
  test("owner signing on the ESC template needs every tick; the single 'accept' tick is not enough", () => {
    const base = { status: "awaiting_owner", templateApproved: true, templateVersion: esc, scheduledStart: start, nowIso: now };
    expect(ownerConsentBlockers({ ...base, input })).toEqual([]);
    expect(ownerConsentBlockers({ ...base, input: { ...input, declarations: { ...all, owner_or_authorised: false } } }).join()).toMatch(/Please tick: "I am the owner/);
    expect(ownerConsentBlockers({ ...base, input: { ...input, declarations: undefined } })).toHaveLength(4);
    // older wording (lawyer text) keeps the single tick rule
    expect(ownerConsentBlockers({ ...base, templateVersion: "lawyer-2026-10-06-v1", input: { ...input, declarations: undefined } })).toEqual([]);
    expect(ownerConsentBlockers({ ...base, templateVersion: "lawyer-2026-10-06-v1", input: { ...input, accept: false, declarations: undefined } }).join()).toMatch(/confirm you consent/);
  });
  test("every existing timing rule is kept: exact date, approved wording, status, 24h lead, names", () => {
    const base = { templateApproved: true, templateVersion: esc, nowIso: now, input };
    expect(ownerConsentBlockers({ ...base, status: null, scheduledStart: null })[0]).toMatch(/exact installation date/);
    expect(ownerConsentBlockers({ ...base, status: "awaiting_owner", templateApproved: false, scheduledStart: start }).join()).toMatch(/not been approved/);
    expect(ownerConsentBlockers({ ...base, status: "stale", scheduledStart: start }).join()).toMatch(/out of date/);
    expect(ownerConsentBlockers({ ...base, status: "awaiting_owner", scheduledStart: start, nowIso: "2026-11-10T00:00:00.000Z" }).join()).toMatch(/24 hours/);
    expect(ownerConsentBlockers({ ...base, status: "awaiting_owner", scheduledStart: start, input: { ...input, signatureName: "" } }).join()).toMatch(/full name to sign/);
    expect(latestConsentAt(start)).toBe("2026-11-09T22:00:00.000Z");
  });
});

describe("Section 3: AP Part A details and Part B declaration", () => {
  test("Part B wording is verbatim with the representative's name", () => {
    expect(apDeclarationText("Jo Lowe")).toBe(`I Jo Lowe, am the authorised representative of ${ESC_AP_FULL_NAME} and declare that I have explained to the property owner the purpose for which this written consent is being obtained.`);
    expect(apDeclarationText("")).toContain("I <insert name>,");
    expect(apRepFullName(rep)).toBe("Jo Lowe");
  });
  test("AP signing on the ESC template needs first/last name, role and the Part B tick; 24h lead and order kept", () => {
    const base = { status: "awaiting_ap", scheduledStart: start, nowIso: now, apRepName: "Jo Lowe", purposeExplained: true, templateVersion: esc };
    expect(apConsentBlockers({ ...base, apRep: rep })).toEqual([]);
    expect(apConsentBlockers({ ...base, apRep: { ...rep, role: "" } }).join()).toMatch(/role is required/);
    expect(apConsentBlockers({ ...base, apRep: null }).join()).toMatch(/first name is required/);
    expect(apConsentBlockers({ ...base, apRep: rep, purposeExplained: false }).join()).toMatch(/Part B declaration/);
    expect(apConsentBlockers({ ...base, apRep: rep, status: "awaiting_owner" })[0]).toMatch(/owner must sign first/);
    expect(apConsentBlockers({ ...base, apRep: rep, nowIso: "2026-11-10T00:00:00.000Z" }).join()).toMatch(/24 hours/);
    // older wording: name + purpose tick only
    expect(apConsentBlockers({ ...base, templateVersion: "lawyer-2026-10-06-v1" })).toEqual([]);
  });
  test("consent validity for the booking is unchanged (both signatures ≥24h before start)", () => {
    expect(consentValidityBlockers({ status: "valid", scheduled_start: start, owner_signed_at: now, ap_signed_at: "2026-11-02T00:00:00.000Z" }, start)).toEqual([]);
    expect(consentValidityBlockers({ status: "valid", scheduled_start: start, owner_signed_at: now, ap_signed_at: "2026-11-10T12:00:00.000Z" }, start)[0]).toMatch(/less than 24h/);
  });
});

describe("rendering the executed form", () => {
  test("ESC template: Section 1 values, ticks, owner signature + Melbourne date, Part A details, Part B with name, AP signature + date", () => {
    const out = renderConsentBody({ version: esc, body: "ignored for ESC versions – rendered from the template structure", facts, owner: { signatureName: "Mary Anne Citizen", signedAt: "2026-11-01T20:00:00.000Z", declarations: all }, ap: { rep, signedAt: "2026-11-02T20:00:00.000Z" } });
    const lines = out.split("\n");
    expect(lines[0]).toBe("Section 1: Information to be shared");
    expect(lines).toContain("First Name: Mary Anne");
    expect(lines).toContain("Last name: Citizen");
    expect(lines).toContain("Installation address: 12 Sample St, Reservoir VIC 3073");
    expect(lines).toContain("Phone number: 0400 000 000");
    expect(lines).toContain("Email address: mary@example.com");
    for (const d of OWNER_DECLARATIONS) expect(lines).toContain(`[x] ${d.text}`);
    expect(lines).toContain("Owner signature: Mary Anne Citizen  Date: 2026-11-02");
    expect(lines).toContain(`Accredited person name: ${ESC_AP_FULL_NAME}`);
    expect(lines).toContain("First name: Jo");
    expect(lines).toContain("Last name: Lowe");
    expect(lines).toContain("Role: Director");
    expect(lines).toContain("Phone number: 03 9000 0000");
    expect(lines).toContain("Email address: jo@homeinsulationvictoria.com.au");
    expect(lines).toContain(apDeclarationText("Jo Lowe"));
    expect(lines).toContain("Accredited person signature: Jo Lowe  Date: 2026-11-03");
    expect(out).not.toContain("<insert name");
    expect(out).not.toContain("{dates}");
  });
  test("ESC template before signing: unticked boxes and blank signatures", () => {
    const out = renderConsentBody({ version: esc, body: "", facts });
    expect(out).toContain("[ ] the details listed above are complete and accurate.");
    expect(out).toContain("Owner signature: —  Date: —");
    expect(out).toContain("I <insert name>, am the authorised representative");
  });
  test("older wording keeps its body with {dates} filled from the installation day(s)", () => {
    expect(isEscTemplateVersion("lawyer-2026-10-06-v1")).toBe(false);
    expect(isEscTemplateVersion(esc)).toBe(true);
    const out = renderConsentBody({ version: "lawyer-2026-10-06-v1", body: "my install day(s) ({dates}), my property address", facts });
    expect(out).toBe("my install day(s) (2026-11-11), my property address");
  });
});

describe("executed copy to the owner (ESC recommends providing a copy)", () => {
  test("wording approved (decision 170): kit design, approved sentence, form text in the body, TEST label on TEST jobs", () => {
    expect(CONSENT_COPY_EMAIL_APPROVED).toBe(true);
    const mail = renderConsentCopyEmail({ firstName: "Mary", installationDays: ["2026-11-11"], address: facts.premises_address, templateVersion: esc, formText: "Section 1: Information to be shared\nFirst Name: Mary Anne", sha256: "abc", myJobUrl: null, test: true });
    expect(mail.subject).toBe("Your signed consent form");
    expect(mail.text).toContain("Hi Mary,");
    expect(mail.text).toContain(`Here's your copy of the owner's consent form you signed for the ceiling insulation at ${facts.premises_address}. The full form is below. Just reply if you'd like a PDF copy.`);
    // O63 design: the form's "First Name" label shows as "First name" like the other labels; the answer is kept.
    expect(mail.text).toContain("First name: Mary Anne");
    expect(mail.html).toContain("<strong>Mary Anne</strong>");
    expect(mail.html).toContain("TEST — only sent to Jo");
    expect(mail.html).not.toContain("See my job");
    expect(renderConsentCopyEmail({ firstName: "Mary", installationDays: [], address: facts.premises_address, templateVersion: esc, formText: "x", sha256: "abc", myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/t" }).html).toContain(">See my job<");
  });
  test("server wiring: AP signing renders the template, stores ticks/rep and emails through the guarded owner path", () => {
    const server = readFileSync("src/lib/consent.server.ts", "utf8");
    expect(server).toContain("renderConsentBody(");
    expect(server).toContain("owner_declarations: declarations");
    expect(server).toContain("ap_rep: rep");
    expect(server).toContain("emailOwnerConsentCopy(");
    const copy = readFileSync("src/lib/consent-copy-email.server.ts", "utf8");
    expect(copy).toContain('job.source === "qa_test"');
    expect(copy).toContain("sendTestEmail(");
    expect(copy).toContain("CONSENT_COPY_EMAIL_APPROVED");
    expect(copy).toContain("assertCustomerDeliveryAllowed(");
    expect(copy).toContain("sendGuardedOwnerEmail(");
    expect(copy).not.toMatch(/resendSend\(|fetch\(/);
    for (const t of ["storage.from(\"job-files\").download", "attachments", "copyPath"]) expect(copy).toContain(t);
    expect(server).toContain("copyPath: path");
  });
  test("the staged migration cites the ESC file and its hash, Jo's admin user, and keeps the lawyer row", () => {
    const sql = readFileSync("docs/pending-migrations/0226_esc_consent_template_v1.sql", "utf8");
    expect(sql).toContain("e6458b32666a01a5a3d06718cf0ee33b601077761c6f14f77d20bee5d7753151");
    expect(sql).toContain("950fa0b6-dc44-49af-a754-6a65f26a661e");
    expect(sql).toContain(`'${esc}'`);
    expect(sql).not.toMatch(/DELETE FROM public\.compliance_templates/);
    for (const d of OWNER_DECLARATIONS) expect(sql).toContain(d.text);
  });
});
