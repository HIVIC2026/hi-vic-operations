// Office build B (O5 Partners, O6 Money, O7 Communications / Settings): the pure rules behind every new screen element.
// Each block names the decision it proves; the screen-level proof table is docs/OFFICE_STATES_PROOF_B.md.
import { describe, expect, test } from "bun:test";
import { officeLegacyTarget } from "../src/lib/legacy-links.core";
import { readFileSync } from "node:fs";
import { jobMargin, marginTotal, veecValueReceived } from "../src/lib/job-margin.core";
import { groupPayouts, invoiceRowState, stepsLine, veecRegistryLabel } from "../src/lib/office-money.core";
import { applicationChecks, maskBank, missingItemsMessage, personRow, postcodeSummary, rateCardLine } from "../src/lib/office-partners.core";
import { failureReason, groupHeld, heldReason, outlookState, splitHeldKeys, type HeldItem } from "../src/lib/office-comms.core";
import { AUTOMATIC_RULES, OFFICE_SWITCH_COLUMNS, SWITCHES, heldGroupsFor, smsTypeSwitches, switchState, withSmsSwitch } from "../src/lib/office-settings.core";

const read = (p: string) => readFileSync(p, "utf8");

describe("decision 230: one pure margin rule (job-margin.core)", () => {
  test("matches the approved O6 mock-up rows (price ex GST − trades + VEEC net; % of price)", () => {
    const m = jobMargin({ ownerPriceInc: 5980, installerPayEx: 3650, piesaCostEx: 280, fixesCostEx: 0, veecValue: 1876, veecIncentive: 1756 });
    expect(m.margin).toBe(1626.36);
    expect(m.pct).toBe(27);
    expect(m.veecNet).toBe(120);
    const n = jobMargin({ ownerPriceInc: 4420, installerPayEx: 2780, piesaCostEx: 280, fixesCostEx: 0, veecValue: 80, veecIncentive: 0 });
    expect(Math.round(n.margin!)).toBe(1038);
    expect(n.pct).toBe(23);
  });
  test("fixes cost is subtracted; the $100 on fixes stays ours because it is only in the owner price", () => {
    const base = { ownerPriceInc: 6000, installerPayEx: 3000, piesaCostEx: 250, veecValue: 0, veecIncentive: 0 };
    const withFixes = jobMargin({ ...base, ownerPriceInc: 6000 + 600, fixesCostEx: 500 / 1.1 });
    const without = jobMargin({ ...base, fixesCostEx: 0 });
    expect(Math.round(withFixes.margin! - without.margin!)).toBe(Math.round(100 / 1.1));
  });
  test("unknown inputs are never guessed", () => {
    const m = jobMargin({ ownerPriceInc: 5000, installerPayEx: null, piesaCostEx: null, fixesCostEx: 0, veecValue: null, veecIncentive: 0 });
    expect(m.margin).toBeNull();
    expect(m.missing).toEqual(["Installer pay not recorded on the quote", "Electrician PIESA rate not agreed", "VEEC value not worked out (no VEEC count)"]);
    expect(jobMargin({ ownerPriceInc: null, installerPayEx: 1, piesaCostEx: 0, fixesCostEx: 0, veecValue: 0, veecIncentive: 0 }).known).toBe(false);
  });
  test("VEEC value: sold > lodged at spot > quote count at spot", () => {
    expect(veecValueReceived({ lodgedQty: 19, salePrice: 92.4, quoteCount: 18, spotPrice: 90 })).toEqual({ value: 1755.6, basis: "sold" });
    expect(veecValueReceived({ lodgedQty: 19, salePrice: null, quoteCount: 18, spotPrice: 90 }).value).toBe(1710);
    expect(veecValueReceived({ lodgedQty: null, salePrice: null, quoteCount: 18, spotPrice: 90 }).basis).toBe("quote at today's price");
    expect(veecValueReceived({ lodgedQty: null, salePrice: null, quoteCount: null, spotPrice: 90 }).value).toBeNull();
  });
  test("monthly total counts only known margins, % weighted by price", () => {
    expect(marginTotal([{ margin: 1000, priceInc: 5000 }, { margin: 500, priceInc: 5000 }, { margin: null, priceInc: 4000 }])).toEqual({ total: 1500, jobs: 2, pct: 15, unknown: 1 });
  });
  test("office only: never imported by installer, electrician or owner screens", () => {
    for (const f of ["src/lib/trade-view.server.ts", "src/lib/trade-view.core.ts", "src/lib/owner-myjob.functions.ts"]) expect(read(f)).not.toContain("job-margin");
  });
});

describe("decision 240: invoices read from Xero/Stripe; overdue → Chase, never Record payment", () => {
  const step = (key: "safety_check" | "install_deposit" | "balance", state: "paid" | "requested" | "overdue" | "not_yet", dueAt: string | null = null) => ({ key, state, dueAt, amountCents: key === "safety_check" ? 34_900 : 35_100 });
  test("state words", () => {
    const now = "2026-10-24T10:00:00+11:00";
    expect(invoiceRowState([step("safety_check", "paid"), step("install_deposit", "overdue", "2026-10-24T01:00:00+11:00"), step("balance", "not_yet")], now)).toEqual({ label: "Deposit overdue · 9h", tone: "rose", chase: true });
    expect(invoiceRowState([step("safety_check", "paid"), step("install_deposit", "paid"), step("balance", "overdue", "2026-10-20T10:00:00+11:00")], now).label).toBe("Balance overdue · 4 days");
    expect(invoiceRowState([step("safety_check", "paid"), step("install_deposit", "paid"), step("balance", "paid")], now)).toEqual({ label: "Paid in full", tone: "green", chase: false });
    expect(invoiceRowState([], now).label).toBe("Not in Xero yet");
  });
  test("steps line", () => {
    expect(stepsLine([step("safety_check", "paid"), step("install_deposit", "requested"), step("balance", "not_yet")])).toBe("$349 ✓ · deposit $351 due · balance $351 —");
    expect(stepsLine([step("safety_check", "paid"), step("balance", "paid")])).toBe("All steps ✓");
  });
  test("no Record payment on the Money screen or in its server functions", () => {
    const ui = read("src/routes/_authenticated/admin.money.tsx");
    expect(ui).not.toMatch(/>\s*Record payment|recordOwnerPayment|recordManualPayment/);
    expect(read("src/lib/office-money.functions.ts")).not.toMatch(/recordOwnerPayment|recordManualPayment|owner_payment_recorded/);
    expect(ui).toContain("Chase ›");
    expect(ui).toContain("LogCallDialog");
  });
});

describe("decisions 30/109: payouts grouped per business, Mark paid per group", () => {
  test("due grouped by business + trade; paid kept apart", () => {
    const g = groupPayouts([
      { jobId: "a", jobNumber: "HV-1", businessId: "b1", business: "Reinsulate", kind: "installation", amountEx: 1000, dueAt: "2026-10-31", paidAt: null },
      { jobId: "b", jobNumber: "HV-2", businessId: "b1", business: "Reinsulate", kind: "installation", amountEx: 500.5, dueAt: "2026-10-30", paidAt: null },
      { jobId: "a", jobNumber: "HV-1", businessId: "e1", business: "Volt Right", kind: "assessment", amountEx: null, dueAt: "2026-10-31", paidAt: null },
      { jobId: "c", jobNumber: "HV-3", businessId: "b1", business: "Reinsulate", kind: "installation", amountEx: 900, dueAt: "2026-10-20", paidAt: "2026-10-17T05:00:00Z" },
    ]);
    expect(g.due.map((x) => [x.business, x.trade, x.jobs.length, x.amountEx, x.dueAt])).toEqual([["Reinsulate", "installer", 2, 1500.5, "2026-10-30"], ["Volt Right", "electrician", 1, null, "2026-10-31"]]);
    expect(g.paid).toHaveLength(1);
  });
  test("registry words", () => {
    expect(veecRegistryLabel({ stage: "complete", lodgementStatus: "approved", submittedDate: "2026-10-20", ownerSigned: true })).toBe("Registered");
    expect(veecRegistryLabel({ stage: "complete", lodgementStatus: "submitted", submittedDate: "2026-10-20", ownerSigned: true })).toBe("Lodged 2026-10-20 · pending");
    expect(veecRegistryLabel({ stage: "final_check", lodgementStatus: null, submittedDate: null, ownerSigned: false })).toBe("Owner to sign the form");
    expect(veecRegistryLabel({ stage: "final_check", lodgementStatus: null, submittedDate: null, ownerSigned: true })).toBe("Final check first");
  });
});

describe("O5 Partners: people, checks, coverage (decisions 130, 153, 22/188, 229, 232)", () => {
  const today = "2026-10-24";
  test("one next action per person in decision order: CII → notice → Mitti", () => {
    expect(personRow({ role: "installer", eec: "awaiting_check", cii: null, noticeAck: true, noticeFirstSentAt: null, mitti: "member" }, today)).toMatchObject({ ciiLabel: "To verify", action: "verify_cii" });
    expect(personRow({ role: "installer", eec: "verified", cii: { level: "full", expiresOn: "2027-06-03", cleared: true, reason: null }, noticeAck: false, noticeFirstSentAt: "2026-10-17T00:00:00Z", mitti: "member" }, today)).toMatchObject({ ciiTone: "green", noticeLabel: "Outstanding 7d", action: "send_notice" });
    expect(personRow({ role: "installer", eec: "verified", cii: { level: "full", expiresOn: "2027-09-01", cleared: true, reason: null }, noticeAck: true, noticeFirstSentAt: null, mitti: "not_found" }, today)).toMatchObject({ mittiLabel: "No", action: "invite_mitti" });
    expect(personRow({ role: "electrician", eec: "not_applicable", cii: null, licenceNumber: "A123", licenceExpiresOn: "2028-06-30", noticeAck: null, noticeFirstSentAt: null, mitti: "member" }, today).action).toBeNull();
  });
  test("a verified CII without level/expiry is NOT cleared (decision 153: derived clearance)", () => {
    const r = personRow({ role: "installer", eec: "verified", cii: { level: null, expiresOn: null, cleared: false, reason: "no level" }, noticeAck: true, noticeFirstSentAt: null, mitti: "member" }, today);
    expect(r.ciiTone).toBe("rose");
    expect(r.action).toBe("verify_cii");
  });
  test("postcodes, rate cards, masked bank", () => {
    expect(postcodeSummary(["3145", "3150", "3170", "3199", "31*"])).toBe("3145–3150 · 3170 · 3199 · 31*");
    expect(postcodeSummary([])).toBe("None verified");
    expect(rateCardLine([{ code: "R5_BATTS", unit_price_ex_gst: 24.5 }, { code: "MIN_JOB", unit_price_ex_gst: 900 }])).toBe("R5.0 batts $24.50/m² · min job $900.00");
    expect(maskBank({ account_name: "Reinsulate Pty Ltd", bsb: "083-001", account_number: "12346214" })).toEqual({ accountName: "Reinsulate Pty Ltd", bsb: "083-•••", account: "••••6214" });
  });
  test("application checks + the Ask message list only what is outstanding", () => {
    const checks = applicationChecks({ type: "installer", today, signedAt: "2026-10-23T05:48:00Z", signerName: "Rob Keane", agreementVersion: "v1.16", hasCertificate: true, verifiedCiiEmails: ["rob@x.example"],
      data: { abn: "62410338915", insurer: "Allianz", public_liability_cover_amount: 20_000_000, public_liability_expiry: "2027-05-08", r5_rate: 23.9, installers: [{ full_legal_name: "Rob Keane", email: "rob@x.example", cii_holds: "held" }, { full_legal_name: "Dylan Price", email: "d@x.example", cii_holds: "not_held" }] } });
    expect(checks.map((c) => c.mark)).toEqual(["ok", "ok", "ok", "ok", "warn", "warn"]);
    const msg = missingItemsMessage(checks);
    expect(msg).toContain("CII certificates · 1 of 2 verified");
    expect(msg).not.toContain("ABN");
  });
  test("screens reuse the guarded functions (approve, CII, notice, Mitti, coverage)", () => {
    const review = read("src/routes/_authenticated/admin.partners_.application.$enquiryId.tsx");
    expect(review).toContain("decidePartnerApplication");
    expect(review).toContain("<ApprovePartner applicationId={appId} showReviewDecision={false} />");
    const people = read("src/components/portal/partner-people.tsx");
    for (const fn of ["officeVerifyEec", "SendNoticeLinkInline", "checkMittiAccess", "mittiInviteLine"]) expect(people).toContain(fn);
    expect(read("src/components/portal/partner-coverage.tsx")).toContain("verify_coverage: true");
    expect(read("src/lib/office-partners.server.ts")).toContain("partner_bank_details_revealed");
  });
  test("audit removals: Partners overview and Team-ups are redirects only", () => {
    expect(officeLegacyTarget("partners-overview")).toEqual({ to: "/admin/partners" });
    expect(officeLegacyTarget("team-ups")).toEqual({ to: "/admin/partners", search: { tab: "people" } });
  });
});

describe("O7 Communications: held, failed, Outlook (decisions 16, 159, 165)", () => {
  const item = (over: Partial<HeldItem>): HeldItem => ({ key: "sms:00000000-0000-4000-8000-000000000001", source: "sms", type: "quote_ready", label: "Quote ready", channel: "text", audience: "owner", state: "held", reason: "customer texts off", who: "A", jobId: null, jobNumber: null, at: "2026-10-23T00:00:00Z", ...over });
  test("held reasons in plain words", () => {
    expect(heldReason("Customer communications are switched off", "text")).toBe("customer texts off");
    expect(heldReason('"Spot saved confirmation" texts are switched off', "text")).toBe("spot saved confirmation texts off");
    expect(heldReason("Too late to send – the trigger was 30h ago (limit 24h)", "text")).toBe("too late to send");
  });
  test("grouped by type + channel, held before queued, biggest first", () => {
    const g = groupHeld([item({}), item({ key: "sms:00000000-0000-4000-8000-000000000002" }), item({ key: "fu:00000000-0000-4000-8000-000000000003", source: "followup", type: "followup:x", label: "Reminder", channel: "email", state: "queued" }), item({ key: "sms:00000000-0000-4000-8000-000000000004", type: "spot_saved", label: "Spot saved" })]);
    expect(g.map((x) => [x.id, x.count])).toEqual([["held:text:quote_ready", 2], ["held:text:spot_saved", 1], ["queued:email:followup:x", 1]]);
  });
  test("cancel keys are validated, never guessed", () => {
    const s = splitHeldKeys(["sms:00000000-0000-4000-8000-000000000001", "fu:00000000-0000-4000-8000-000000000002", "jc:00000000-0000-4000-8000-000000000003", "sms:nope", "x:00000000-0000-4000-8000-000000000004"]);
    expect([s.sms.length, s.followups.length, s.messages.length, s.invalid.length]).toEqual([1, 1, 1, 2]);
  });
  test("failure reasons and Outlook states", () => {
    expect(failureReason("Twilio 400: 21614 not a mobile")).toBe("Number rejected by the carrier");
    expect(failureReason("550 mailbox not found")).toBe("Bounced · address not found");
    expect(failureReason("No answer from Twilio – may have sent, not retried")).toBe("Unknown — may have sent; not retried");
    expect(outlookState({ kind: "job" }, "inbound", "complete")).toBe("Recorded on the job");
    expect(outlookState({ kind: "job" }, "outbound", "complete")).toBe("Recorded · sent from Outlook");
    expect(outlookState({ kind: "unmatched" }, "inbound", "complete")).toBe("Unmatched · stays in Outlook");
  });
  test("no send and no retry anywhere on Communications", () => {
    const ui = read("src/routes/_authenticated/admin.communications.tsx");
    expect(ui).not.toMatch(/retryFailedIneligibleEmail|sendRealSms|>\s*Retry/);
    expect(read("src/lib/office-comms.server.ts")).not.toMatch(/sendRealSms|sendGuardedOwnerEmail|deliverTracked/);
  });
});

describe("O7 Settings: switches, rules, removals (decisions 159, 246, 248; audit)", () => {
  test("decision 246 switches are listed, office-editable columns, pending migration named", () => {
    const keys = SWITCHES.map((s) => s.key);
    expect(keys).toContain("auto_installer_offers");
    expect(keys).toContain("auto_electrician_offers");
    expect(OFFICE_SWITCH_COLUMNS).toContain("auto_installer_offers");
    expect(switchState(SWITCHES.find((s) => s.key === "auto_installer_offers")!, { customer_comms_enabled: false }).editable).toBe(false);
    expect(switchState(SWITCHES.find((s) => s.key === "auto_installer_offers")!, { auto_installer_offers: true }).on).toBe(true);
    expect(read("docs/pending-migrations/auto-offer-switches.sql")).toMatch(/auto_installer_offers boolean not null default false/);
  });
  test("code switches are read-only; the owner-signs-again switch is not offered", () => {
    const code = SWITCHES.filter((s) => s.kind === "code");
    expect(code.map((s) => s.key)).toEqual(["auto_quote_send", "consent_copy"]);
    for (const s of code) expect(switchState(s, {}).editable).toBe(false);
    expect(JSON.stringify(SWITCHES)).not.toContain("owner_resign");
    expect(read("src/components/portal/owner-documents.tsx")).not.toMatch(/ResignSwitch|setResignSwitchFn/);
  });
  test("per-type text switches only change their own key; unapproved wording can't be switched on", () => {
    expect(withSmsSwitch({ job_offer: true }, "spot_saved", true)).toEqual({ job_offer: true, spot_saved: true });
    expect(smsTypeSwitches().some((s) => s.key === "sms:job_offer")).toBe(true);
    expect(heldGroupsFor(SWITCHES.find((s) => s.key === "spot_saved")!)("held:text:spot_saved")).toBe(true);
    expect(heldGroupsFor(SWITCHES.find((s) => s.key === "customer_comms")!)("queued:email:x")).toBe(false);
  });
  test("automatic rules are read-only facts with a decision each", () => {
    expect(AUTOMATIC_RULES.every((r) => r.why.length > 0)).toBe(true);
    expect(AUTOMATIC_RULES.map((r) => r.rule)).toContain("Automatic installer offers");
  });
  test("Compliance Setup + Owner paperwork merged into Settings › Templates; Xero moved to Settings", () => {
    const settings = read("src/routes/_authenticated/admin.settings.tsx");
    for (const c of ["<ComplianceVersions", "<OwnerDocuments />", "<XeroConnectionCard />", "<MittiFormsSection />", "<EscConfigSection />"]) expect(settings).toContain(c);
    expect(officeLegacyTarget("compliance", { key: "k" })).toEqual({ to: "/admin/settings", search: { tab: "templates", key: "k" } });
    expect(read("src/routes/_authenticated/admin.test-centre.tsx")).not.toContain("XeroConnectionCard");
    expect(read("src/components/portal/compliance-versions.tsx")).not.toMatch(/COMPLIANCE<|installer declaration after installation/);
  });
});
