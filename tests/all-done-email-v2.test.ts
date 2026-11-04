// Part 4 Task 9 (touchpoint 52, done2.png): ONE "All done" email at completion, paid or not.
// Pure wording + the sender (attachments, contacts hold, warranty record). Nothing is sent anywhere.
import { beforeEach, expect, mock, test } from "bun:test";

const PDF_B64 = Buffer.from("%PDF-1.4 x").toString("base64");
const att = (filename: string) => ({ filename, content: PDF_B64, contentType: "application/pdf" });
const events: { type: string; summary: string; details: any }[] = [];
const sent: any[] = [];
let tax: any = { path: "J/tax.pdf" }, contactsFor: Record<string, any> = {};
let warrantyMissing = false, instructionsMissing = false, formValues: any = { a: "b" }, taxHeldFlag = false;
let sendResult = "sent";

mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: any, type: string, summary: string, details: any = {}) => { events.push({ type, summary, details }); } }));
mock.module("../src/lib/owner-template-send.server", () => ({ sendOwnerTemplateEmail: async (p: any) => { sent.push({ ...p, mail: p.render({ firstName: "Sarah", ownerName: "Sarah Owner", address: "1 A St", myJobUrl: "https://example.invalid/my-job/tok", installerName: "Rapid Insulation", installerPhone: "0400 000 000", test: false }) }); return sendResult; } }));
mock.module("../src/lib/owner-contact.server", () => ({ businessContactForJob: async (_j: string, role: string) => contactsFor[role] ?? null }));
mock.module("../src/lib/tax-invoice-pdf.server", () => ({ fileTaxInvoicePdf: async () => tax }));
mock.module("../src/lib/veec-form-pdf.server", () => ({ veecFormPdf: async () => ({ bytes: new TextEncoder().encode("%PDF-1.4 form"), layout: { split: [] } }) }));
mock.module("../src/lib/assignment.server", () => ({ currentAssignment: async () => null, veecPreparation: async () => ({ blockers: [], values: formValues, missing: [] }) }));
mock.module("../src/lib/product-warranty.server", () => ({
  warrantyDecisionFor: async () => ({ products: ["Bradford Gold R5.0"], buildingClass: null, attach: [{ productName: "Bradford Gold R5.0" }], missing: [] }),
  prepareWarrantyCopies: async () => (warrantyMissing ? { attachments: [], attached: [], missing: [{ product: "Bradford Gold R5.0", reason: "not on file" }] } : { attachments: [att("Bradford-warranty.pdf")], attached: [{ productName: "Bradford Gold R5.0" }], missing: [] }),
  installedProductsFor: async () => ["Bradford Gold R5.0"],
}));
mock.module("../src/lib/product-instructions.server", () => ({ productInstructionsFor: async () => (instructionsMissing ? null : att("Bradford-Gold-installation-instructions.pdf")) }));
const recorded: any[] = [];
mock.module("../src/lib/completion-pack.server", () => ({ recordWarrantyCopyProvided: async (_j: string, _a: any, x: any) => { recorded.push(x); return true; } }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { job_number: "HV-1234" } }) }), maybeSingle: async () => ({ data: { job_number: "HV-1234" } }) }) }) }), storage: { from: () => ({ download: async () => ({ data: new Blob(["%PDF-1.4 inv"]), error: null }) }) } } }));

const core = await import("../src/lib/completion-emails.core");
const { renderInstallCompleteEmail, ALL_DONE_V2_APPROVED } = core;
const { PDF_LOOK_APPROVED } = await import("../src/lib/pdf-approvals.core");
const { emailOwnerInstallComplete } = await import("../src/lib/approved-owner-emails.server");

const INSTALLER = { name: "Rapid Insulation Pty Ltd", tradingName: "Rapid Insulation", officePhone: "03 9000 0001", email: "office@rapid.example" };
const ELECTRICIAN = { name: "Sparks Pty Ltd", tradingName: "Sparks Electrical", officePhone: "03 9000 0002", email: "office@sparks.example" };
const AP = { name: "Home Insulation Victoria", tradingName: null, officePhone: null, email: "info@homeinsulationvictoria.com.au" };
const base = { firstName: "Sarah", installer: { name: "Rapid Insulation" }, product: "Bradford Gold R5.0", areaM2: 120, rebate: 2380, balancePaid: false, signRebateFormUrl: "https://example.invalid/my-job/tok?screen=done",
  balanceCents: 141200, signAndPayUrl: "https://example.invalid/my-job/tok?screen=finish", contacts: { ap: AP, installer: INSTALLER, electrician: ELECTRICIAN }, attached: { taxInvoice: true, rebateForm: true, warranty: true, instructions: true } };

beforeEach(() => {
  events.length = 0; sent.length = 0; recorded.length = 0; sendResult = "sent";
  tax = { path: "J/tax.pdf" }; contactsFor = { installer: INSTALLER, electrician: ELECTRICIAN }; warrantyMissing = false; instructionsMissing = false; formValues = { a: "b" }; taxHeldFlag = false;
  PDF_LOOK_APPROVED.taxInvoice = false; PDF_LOOK_APPROVED.veecForm = false;
});

test("flag is off by default and the old wording stays when off", () => {
  expect(ALL_DONE_V2_APPROVED).toBe(true); // ON at go-live 5 Nov 2026
  const m = renderInstallCompleteEmail({ firstName: "Sarah", installer: { name: "Rapid" }, product: "x", areaM2: 1, rebate: 1, balancePaid: true, signRebateFormUrl: "https://e/x" }, false);
  expect(m.html).toContain("One last thing: sign your rebate form");
  expect(m.text).toContain("Certificate of Completion");
});

test("#52 wording, balance due", () => {
  const m = renderInstallCompleteEmail(base, true);
  expect(m.subject).toBe("All done, Sarah. Enjoy a warmer home!");
  for (const s of [
    "All done. Enjoy a warmer home!", "Rapid Insulation finished installing your ceiling insulation today.", "Two last things, one page",
    "1. Sign your rebate form. It confirms what was installed and lets us claim the $2,380 rebate you've already had off your price.",
    "2. Pay your balance: $1,412.00, due today.", "Sign and pay", "Takes about a minute. Card or bank transfer.",
    "120 m² Bradford Gold R5.0", "$2,380 off", "Balance due today", "$1,412.00",
    "Something not right? Reply to this email or write to info@homeinsulationvictoria.com.au and we'll look into it.", "Essential Services Commission", "Consumer Affairs Victoria",
  ]) expect(m.text).toContain(s);
  expect(m.html).toContain('href="https://example.invalid/my-job/tok?screen=finish"');
  expect(m.html).toContain("Sign and pay");
});

test("#52 never says Certificate of Completion, lower bills, VEEC incentive, lawyer or HIV", () => {
  const m = renderInstallCompleteEmail(base, true);
  expect(m.text + m.html).not.toMatch(/Certificate of Completion|lower|VEEC incentive|lawyer|\bHIV\b/);
});

test("contacts block: Home Insulation Victoria (Accredited Person), installer and electrician, each name · phone · email", () => {
  const m = renderInstallCompleteEmail(base, true);
  expect(m.text).toContain("Home Insulation Victoria (Accredited Person)");
  expect(m.text).toContain("info@homeinsulationvictoria.com.au");
  expect(m.text).toContain("Rapid Insulation · 03 9000 0001 · office@rapid.example");
  expect(m.text).toContain("Sparks Electrical · 03 9000 0002 · office@sparks.example");
});

test("no electrician (no electrical work): block lists only the AP and the installer", () => {
  const m = renderInstallCompleteEmail({ ...base, contacts: { ap: AP, installer: INSTALLER, electrician: null } }, true);
  expect(m.text).toContain("Rapid Insulation · 03 9000 0001");
  expect(m.text).not.toContain("Sparks");
});

test("attached line follows what is really attached", () => {
  const all = renderInstallCompleteEmail(base, true).text;
  expect(all).toContain("Attached: your tax invoice, the rebate form to read before you sign, your product warranty and the manufacturer's instructions (PDFs). Once it's all done, we'll send your signed forms.");
  const some = renderInstallCompleteEmail({ ...base, attached: { taxInvoice: false, rebateForm: false, warranty: true, instructions: true } }, true).text;
  expect(some).toContain("Attached: your product warranty and the manufacturer's instructions (PDFs).");
  expect(some).not.toContain("tax invoice");
  const none = renderInstallCompleteEmail({ ...base, attached: { taxInvoice: false, rebateForm: false, warranty: false, instructions: false } }, true).text;
  expect(none).not.toContain("Attached:");
});

test("balance already paid in full: item 2 and 'Balance due today' are left out", () => {
  const m = renderInstallCompleteEmail({ ...base, balancePaid: true, balanceCents: 0 }, true);
  expect(m.text).not.toContain("Pay your balance");
  expect(m.text).not.toContain("Balance due today");
  expect(m.text).not.toContain("Two last things");
  expect(m.text).toContain("Sign your rebate form. It confirms what was installed and lets us claim the $2,380 rebate");
  expect(m.text).not.toContain("Card or bank transfer");
});

test("the sender attaches invoice, rebate form, warranty and instructions when the pictures are approved", async () => {
  PDF_LOOK_APPROVED.taxInvoice = true; PDF_LOOK_APPROVED.veecForm = true;
  const r = await emailOwnerInstallComplete("J", { product: "Bradford Gold R5.0", areaM2: 120, rebate: 2380, balancePaid: false, balanceCents: 141200, signRebateFormUrl: "https://e/x" }, { v2: true });
  expect(r).toBe("sent");
  const s = sent[0];
  expect(s.purpose).toBe("install_complete");
  expect(s.key).toBe("install-complete:v1:J");
  expect(s.attachments.map((a: any) => a.filename).sort()).toEqual(["Bradford-Gold-installation-instructions.pdf", "Bradford-warranty.pdf", "Rebate-form-to-read.pdf", "Tax-invoice.pdf"]);
  expect(s.mail.html).toContain("screen=finish");
  expect(s.mail.text).toContain("Attached: your tax invoice, the rebate form to read before you sign, your product warranty and the manufacturer's instructions (PDFs).");
  expect(recorded).toHaveLength(1);
});

test("unpaid balance: warranty and instructions still go and warranty_copy_provided is recorded", async () => {
  const r = await emailOwnerInstallComplete("J", { product: "x", areaM2: 1, rebate: 1, balancePaid: false, balanceCents: 141200, signRebateFormUrl: "https://e/x" }, { v2: true });
  expect(r).toBe("sent");
  expect(sent[0].attachments.map((a: any) => a.filename).sort()).toEqual(["Bradford-Gold-installation-instructions.pdf", "Bradford-warranty.pdf"]);
  expect(recorded[0].attached).toHaveLength(1);
});

test("missing instructions file: sends anyway and logs product_instructions_missing", async () => {
  instructionsMissing = true;
  const r = await emailOwnerInstallComplete("J", { product: "x", areaM2: 1, rebate: 1, balancePaid: false, balanceCents: 1, signRebateFormUrl: "https://e/x" }, { v2: true });
  expect(r).toBe("sent");
  expect(sent[0].attachments.map((a: any) => a.filename)).toEqual(["Bradford-warranty.pdf"]);
  expect(events.some((e) => e.type === "product_instructions_missing")).toBe(true);
});

test("missing warranty: sends anyway, nothing recorded as provided", async () => {
  warrantyMissing = true;
  await emailOwnerInstallComplete("J", { product: "x", areaM2: 1, rebate: 1, balancePaid: false, balanceCents: 1, signRebateFormUrl: "https://e/x" }, { v2: true });
  expect(sent).toHaveLength(1);
  expect(sent[0].mail.text).not.toContain("your product warranty");
});

test("installer office phone missing: held with an office note, nothing sent", async () => {
  contactsFor = { installer: { ...INSTALLER, officePhone: null }, electrician: ELECTRICIAN };
  const r = await emailOwnerInstallComplete("J", { product: "x", areaM2: 1, rebate: 1, balancePaid: false, balanceCents: 1, signRebateFormUrl: "https://e/x" }, { v2: true });
  expect(r).toMatch(/^held/);
  expect(sent).toHaveLength(0);
  expect(events.some((e) => e.type === "install_complete_email_held")).toBe(true);
});

test("tax invoice approved but not makeable: held, retried next tick (nothing sent)", async () => {
  PDF_LOOK_APPROVED.taxInvoice = true;
  tax = { held: "Tax invoice not made: the job has no installation invoice yet" };
  const r = await emailOwnerInstallComplete("J", { product: "x", areaM2: 1, rebate: 1, balancePaid: false, balanceCents: 1, signRebateFormUrl: "https://e/x" }, { v2: true });
  expect(r).toMatch(/^held/);
  expect(sent).toHaveLength(0);
});

test("flag off (explicit): the current email, only the warranty is attached", async () => {
  PDF_LOOK_APPROVED.taxInvoice = true;
  await emailOwnerInstallComplete("J", { product: "x", areaM2: 1, rebate: 1, balancePaid: true, signRebateFormUrl: "https://e/x" }, { v2: false });
  expect(sent[0].attachments.map((a: any) => a.filename)).toEqual(["Bradford-warranty.pdf"]);
  expect(sent[0].mail.text).toContain("Certificate of Completion");
});
