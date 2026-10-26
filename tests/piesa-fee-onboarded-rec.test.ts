// Decisions 302/303 (Jo 25 Oct 2026). Pure — no database, no Xero, no Mitti. Run: bun test tests/piesa-fee-onboarded-rec.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { PIESA_LINE_CODE, SAFETY_CHECK_DEFAULT_CENTS, piesaLineCents, safetyCheckCentsFor, safetyCheckIncGstFor, safetyCheckShort } from "../src/lib/safety-check-amount.core";
import { PAY_LINE_SAFETY_CHECK, SAFETY_CHECK_CENTS, howYouPayLines, payNowBlock, paymentPlan, paymentSteps, payableNow, HIV_BANK_DETAILS } from "../src/lib/payments.core";
import { checkoutSessionParams } from "../src/lib/stripe.core";
import { PAYMENT_OPTION_SUMMARY, paymentOptionSummary, splitForOption } from "../src/lib/payment-gate.core";
import { ensureInvoice, type InvoiceRow, type InvoiceStore } from "../src/lib/invoice.lifecycle";
import { stepsLine } from "../src/lib/office-money.core";
import { P2, centsAud, shortAud } from "../src/lib/owner-pages.core";
import { safetyCheckPriceFromLines } from "../src/lib/owner-quote-email.core";
import { installerJobSummary } from "../src/lib/installer-job-summary.core";
import { QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE, QUOTE_HELD_LINE, installerQuoteLine } from "../src/lib/installer-quote-status.core";
import { MITTI_HIV_ELECTRICIAN_INC_GST, resolveMittiElectrician, usualElectrician, type MittiElectricianResolution } from "../src/lib/usual-electrician.core";
import {
  INSTALLER_NOT_ONBOARDED_LINE, INVITE_SKIP_TEXT, approvedRecBlocker, approvedRecFor, electricianInviteKey, heldQuoteNextSweep, isNotOnboardedReason,
  needsMeNotOnboardedLine, notOnboardedReason, onboardedElectricianResolution, recInviteDecision, type ApprovedRecCandidate,
} from "../src/lib/rec-onboarded.core";
import { buildMittiInstallerQuote, mittiQuoteElectricalBlocker } from "../src/lib/mitti-installer-quote.core";
import { quoteReviewReasons } from "../src/lib/office-quote-review.core";
import { AUTO_LINK_SOURCE, autoLinkPlans, recConflictLine, recLinkedLine } from "../src/lib/rec-auto-link.core";

const read = (p: string) => readFileSync(p, "utf8");
const lines349 = [{ code: "INSTALLER_PRICE", line_total_inc_gst: 3000 }, { code: "PIESA", line_total_inc_gst: 349 }, { code: "AP_FEE", line_total_inc_gst: 349 }];
const lines220 = [{ code: "INSTALLER_PRICE", line_total_inc_gst: 3000 }, { code: "PIESA", line_total_inc_gst: 220 }, { code: "AP_FEE", line_total_inc_gst: 349 }];

describe("decision 302 — the upfront safety check is the quote's PIESA line", () => {
  test("PIESA line picked only when exactly one positive line; else the setting, else $349", () => {
    expect(PIESA_LINE_CODE).toBe("PIESA");
    expect(piesaLineCents(lines349)).toBe(34_900);
    expect(piesaLineCents(lines220)).toBe(22_000);
    expect(piesaLineCents([{ code: "PIESA", line_total_inc_gst: 0 }])).toBeNull();
    expect(piesaLineCents([{ code: "PIESA", line_total_inc_gst: 100 }, { code: "PIESA", line_total_inc_gst: 100 }])).toBeNull();
    expect(safetyCheckCentsFor({ lines: lines220 })).toEqual({ cents: 22_000, source: "quote_line" });
    expect(safetyCheckCentsFor({ lines: [], settingIncGst: 299 })).toEqual({ cents: 29_900, source: "setting" });
    expect(safetyCheckCentsFor({ lines: null })).toEqual({ cents: SAFETY_CHECK_DEFAULT_CENTS, source: "default" });
    expect(safetyCheckIncGstFor({ lines: lines220 })).toBe(220);
    expect(safetyCheckShort(34_900)).toBe("$349");
    expect(safetyCheckShort(22_000)).toBe("$220");
    expect(safetyCheckShort(22_050)).toBe("$220.50");
    expect(SAFETY_CHECK_DEFAULT_CENTS).toBe(SAFETY_CHECK_CENTS);
  });

  test("$349 case: every approved wording stays byte-for-byte", () => {
    const plan = paymentPlan({ quoteTotalCents: 300_000, safetyCheckCents: piesaLineCents(lines349) });
    expect(plan.safetyCheckCents).toBe(34_900);
    expect(howYouPayLines(plan)[0]).toBe("$349.00 now for the electrical safety check (card or bank transfer, no fee)");
    const steps = paymentSteps(plan, 0, { safety_check: { requestedAt: "2026-10-25T00:00:00Z" } }, "2026-10-25T01:00:00Z");
    const due = payableNow(plan, steps, 0);
    const block = payNowBlock({ step: due.step, cardAvailable: true, bank: HIV_BANK_DETAILS, reference: "HV-3193", remainingCents: due.remainingCents });
    expect(block.title).toBe("Pre Insulation Electrical Safety Assessment (PIESA) payment: $349.00 due now");
    expect(block.lines[0]).toBe(PAY_LINE_SAFETY_CHECK);
    expect(stepsLine(steps)).toBe("$349 due · deposit $265 — · balance $2,386 —");
    expect(shortAud(splitForOption(3000, 349).deposit)).toBe("$349");
    expect(P2.button(centsAud(349))).toBe("Sign and pay $349.00");
    expect(P2.payNote(shortAud(349))).toBe("Pay the $349 by card or bank transfer, no fees. You'll get your signed copy and invoice by email");
    expect(paymentOptionSummary(349)).toBe(PAYMENT_OPTION_SUMMARY);
    expect(safetyCheckPriceFromLines([{ description: "Pre Insulation Electrical Safety Assessment (PIESA)", lineTotalIncGst: 349 }] as never)).toBe(349);
    expect(installerJobSummary({ installer: "Deep", consent: "granted", mittiAuditId: "a", formProblem: null, basics: { missing: [], stops: [], completed: true }, heldReasons: null, quote: { total: 3000, sent: true, accepted: true, held: false }, warnings: [] }).upTo)
      .toBe("Owner accepted the quote — next is the $349 safety check payment, then the electrician");
  });

  test("$220 case flows through plan, pay-now, Stripe amount, Xero deposit, P2 page, O18, Money line, installer summary", async () => {
    const plan = paymentPlan({ quoteTotalCents: 300_000, safetyCheckCents: piesaLineCents(lines220) });
    expect(plan.safetyCheckCents).toBe(22_000);
    expect(plan.installDepositCents).toBe(27_800); // 10% of (3000 − 220)
    expect(howYouPayLines(plan)[0]).toBe("$220.00 now for the electrical safety check (card or bank transfer, no fee)");
    const steps = paymentSteps(plan, 0, { safety_check: { requestedAt: "2026-10-25T00:00:00Z" } }, "2026-10-25T01:00:00Z");
    const due = payableNow(plan, steps, 0);
    expect(due.dueNowCents).toBe(22_000);
    const block = payNowBlock({ step: due.step, cardAvailable: true, bank: HIV_BANK_DETAILS, reference: "HV-3193", remainingCents: due.remainingCents });
    expect(block.title).toBe("Pre Insulation Electrical Safety Assessment (PIESA) payment: $220.00 due now");
    expect(block.lines[0]).toBe("$220.00 by card or bank transfer — no fee");
    // Stripe Checkout charges exactly the step amount
    const { form } = checkoutSessionParams({ jobId: "j", invoiceId: "i", step: "safety_check", amountCents: due.dueNowCents, jobNumber: "HV-3193", description: "d", successUrl: "https://x/s", cancelUrl: "https://x/c", customerEmail: null, jobSource: null });
    expect(form["line_items[0][price_data][unit_amount]"]).toBe("22000");
    // Xero deposit on the ONE invoice
    const rows: InvoiceRow[] = [];
    const store: InvoiceStore = { find: async (q) => rows.find((r) => r.quote_id === q) ?? null, insert: async (r) => { const row = { ...r, id: "inv", balance_due_date: null, total_paid: 0, deposit_paid_at: null, balance_paid_at: null, xero_invoice_id: null, xero_update_pending: false, deposit_request_raised_at: null, deposit_request_raised_by: null, deposit_request_amount: null, deposit_request_pct: null } as InvoiceRow; rows.push(row); return row; }, update: async () => undefined };
    const { row } = await ensureInvoice(store, { id: "q", job_id: "j", kind: "installation", status: "accepted", customer_total_inc_gst: 3000 }, "2026-10-25", 220);
    expect(row.deposit_amount).toBe(220);
    expect(row.balance_amount).toBe(2780);
    // P2 page strings
    const split = splitForOption(3000, safetyCheckIncGstFor({ lines: lines220 }));
    expect(split.deposit).toBe(220);
    expect(P2.button(centsAud(split.deposit))).toBe("Sign and pay $220.00");
    expect(P2.tick2Sub(shortAud(split.deposit))).toBe("$220 now for the electrical safety check, 10% to book your install day, the rest on install day. Or pay in full any time.");
    expect(paymentOptionSummary(220)).toContain("The $220 Pre Insulation Electrical Safety Assessment (PIESA) payment is needed");
    // O18 "Next" amount comes from the quote lines
    expect(safetyCheckPriceFromLines([{ description: "Pre Insulation Electrical Safety Assessment (PIESA)", lineTotalIncGst: 220 }] as never)).toBe(220);
    // Office Money line and installer summary
    expect(stepsLine(steps)).toBe("$220 due · deposit $278 — · balance $2,502 —");
    expect(installerJobSummary({ installer: "Deep", consent: "granted", mittiAuditId: "a", formProblem: null, basics: { missing: [], stops: [], completed: true }, heldReasons: null, quote: { total: 3000, sent: true, accepted: true, held: false, safetyCheckIncGst: 220 }, warnings: [] }).upTo)
      .toBe("Owner accepted the quote — next is the $220 safety check payment, then the electrician");
  });

  test("servers read the quote's PIESA line, not the setting alone", () => {
    expect(read("src/lib/payments.server.ts")).toContain("safetyCheckCentsFor({ lines: piesaLines ?? [], settingIncGst: ws?.safety_check_payment_inc_gst ?? null })");
    expect(read("src/lib/workflow.server.ts")).toContain("quoteSafetyCheck(quote?.id ?? null)");
    expect(read("src/lib/owner-gates.server.ts")).toContain("quoteSafetyCheck(q.id, setting)");
    expect(read("src/lib/owner-myjob.server.ts")).toContain("safetyCheckIncGstFor({ lines: quote.quote_items ?? [], settingIncGst: ws?.safety_check_payment_inc_gst ?? null })");
    expect(read("src/lib/xero.server.ts")).toContain("ensureInvoice(dbStore, q, melbourneDate(new Date().toISOString()), safety.incGst)");
    expect(read("src/components/portal/office-job.tsx")).toContain("`${safetyCheckShort(s.amountCents)} safety check`");
    expect(read("src/lib/office-stage-cards.core.ts")).toContain("label: safetyCheckShort(q.safetyCheckCents ?? SAFETY_CHECK_DEFAULT_CENTS)");
  });
});

const rec = (over: Partial<ApprovedRecCandidate> = {}): ApprovedRecCandidate => ({
  business_id: "rec-1", name: "Volt Right Pty Ltd", trading_name: "Volt Right Electrical", rec_number: "REC-99001", worker_licences: ["A123212"],
  onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: { id: "rate-1", rate_inc_gst: 220 }, ...over,
});
const usual = { name: "Volt Right Electrical", licence: "REC-99001", priceIncGst: 250, email: "sparky@example.com" };
const none = { name: null, licence: null, priceIncGst: null };

describe("decision 303 — only onboarded electricians", () => {
  test("approved REC = approved + active + an approved electrician + an ACTIVE PIESA rate; anything less fails closed", () => {
    expect(approvedRecBlocker(rec())).toBeNull();
    expect(approvedRecBlocker(rec({ onboarding_status: "submitted" }))).toBe("not an approved, active REC on the portal");
    expect(approvedRecBlocker(rec({ is_active: false }))).toBe("not an approved, active REC on the portal");
    expect(approvedRecBlocker(rec({ approved_electricians: 0 }))).toBe("no approved electrician on the portal");
    expect(approvedRecBlocker(rec({ piesa_rate: null }))).toBe("no active onboarded PIESA rate");
    expect(approvedRecFor({ name: "Volt Right", licence: "rec 99001" }, [rec()]).rec?.piesaRateIncGst).toBe(220);
    expect(approvedRecFor({ name: "ornaldo", licence: "A123212" }, [rec()]).rec?.businessId).toBe("rec-1"); // worker licence match
    expect(approvedRecFor({ name: "Volt Right Electrical", licence: "" }, [rec()]).rec?.businessId).toBe("rec-1"); // exact name
    expect(approvedRecFor({ name: "ornaldo", licence: "A123212" }, [])).toEqual({ rec: null, reason: "not on the portal" });
    expect(approvedRecFor({ name: "ornaldo", licence: "A123212" }, [rec({ piesa_rate: null })]).reason).toBe("no active onboarded PIESA rate");
  });

  test("HIV's electrician = the standard setting (349 default); an approved usual electrician = the REC's onboarded rate, never the declared price", () => {
    const hiv = resolveMittiElectrician({ choice: "hivic", usual: null, different: none, standardPiesaIncGst: 355 });
    expect(hiv).toMatchObject({ ready: true, priceIncGst: 355, source: "hivic" });
    expect(resolveMittiElectrician({ choice: "hivic", usual: null, different: none }).priceIncGst).toBe(MITTI_HIV_ELECTRICIAN_INC_GST);
    expect(onboardedElectricianResolution({ legacy: hiv, usual: null, candidates: [] })).toBe(hiv);
    const legacy = resolveMittiElectrician({ choice: "usual", usual, different: none });
    expect(legacy.priceIncGst).toBe(250);
    const r = onboardedElectricianResolution({ legacy, usual, candidates: [rec()] });
    expect(r).toMatchObject({ ready: true, priceIncGst: 220, source: "approved_rec", recBusinessId: "rec-1", rateId: "rate-1", name: "Volt Right Electrical", reasons: [] });
    const draft = buildMittiInstallerQuote({ price: { ok: true, issues: [], price: { included: ["Ceiling insulation - supply & install"], otherDescription: "", totalIncGst: 3000, agreedWithOwner: false } }, measuredM2: 100, wholeVeec: null, separateLines: [], caps: { metropolitan: true, minCopay: 200 } } as never, r);
    expect(draft.lines.find((l) => l.code === "PIESA")?.line_total_inc_gst).toBe(220);
    expect(mittiQuoteElectricalBlocker(draft.lines as never, r, r)).toBeNull();
  });

  test("usual electrician not an approved REC → held 'Electrician not onboarded: <name>', identity + email kept for the one invite", () => {
    const legacy = resolveMittiElectrician({ choice: "usual", usual, different: none });
    const r = onboardedElectricianResolution({ legacy, usual, candidates: [rec({ onboarding_status: "submitted" })] });
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(["Electrician not onboarded: Volt Right Electrical"]);
    expect(r.notOnboarded).toEqual({ name: "Volt Right Electrical", licence: "REC-99001", email: "sparky@example.com" });
    expect(isNotOnboardedReason(r.reasons[0])).toBe(true);
    expect(notOnboardedReason("X")).toBe("Electrician not onboarded: X");
    expect(INSTALLER_NOT_ONBOARDED_LINE).toBe("Your electrician needs to finish onboarding before the quote goes out");
    expect(QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE).toBe(INSTALLER_NOT_ONBOARDED_LINE);
    expect(installerQuoteLine({ sent: false, accepted: false, declined: false, held: true, electricianNotOnboarded: true })).toBe(INSTALLER_NOT_ONBOARDED_LINE);
    expect(installerQuoteLine({ sent: false, accepted: false, declined: false, held: true })).toBe(QUOTE_HELD_LINE);
    expect(needsMeNotOnboardedLine("ornaldo")).toBe("Quote held · Electrician not onboarded: ornaldo · onboarding invite sent to the electrician once");
    // Needs me (Quotes to check) reasons from the held event / quote hold reason
    expect(quoteReviewReasons("Electrician not onboarded: ornaldo · Waiting for office review before sending", null, null)).toEqual(["Electrician not onboarded: ornaldo"]);
    // An unsaved usual electrician keeps the legacy My-business reminder hold, not the onboarding hold
    const missing = resolveMittiElectrician({ choice: "usual", usual: null, different: none });
    expect(onboardedElectricianResolution({ legacy: missing, usual: null, candidates: [rec()] })).toBe(missing);
  });

  test("the My business nomination may carry email/phone (needed for the invite); no declared price needed (decision 369)", () => {
    expect(usualElectrician({ name: "A", licence: "L", priceIncGst: 200, email: " Sparky@Example.com ", phone: "0400 000 000" })).toEqual({ name: "A", licence: "L", priceIncGst: 200, email: "sparky@example.com", phone: "0400 000 000" });
    expect(usualElectrician({ name: "A", licence: "L", priceIncGst: 200, email: "not-an-email" })).toEqual({ name: "A", licence: "L", priceIncGst: 200 });
    expect(usualElectrician({ name: "A", licence: "L", email: "a@b.co" })).toEqual({ name: "A", licence: "L", email: "a@b.co" });
  });

  test("ONE invite per electrician: skips when issued/attempted/onboarded/no email/comms paused; sends otherwise", () => {
    const el = { installerBusinessId: "inst-1", name: "ornaldo", licence: "A123212", email: "o@example.com" };
    expect(electricianInviteKey(el)).toBe("inst-1:A123212");
    expect(electricianInviteKey({ ...el, licence: null })).toBe("inst-1:o@example.com");
    expect(electricianInviteKey({ ...el, licence: null, email: null })).toBe("inst-1:ornaldo");
    expect(recInviteDecision({ electrician: el, commsEnabled: true, alreadyIssued: false, existingNomination: null })).toEqual({ action: "send", key: "inst-1:A123212" });
    expect(recInviteDecision({ electrician: el, commsEnabled: true, alreadyIssued: true, existingNomination: null })).toMatchObject({ action: "skip", reason: "already_issued" });
    expect(recInviteDecision({ electrician: el, commsEnabled: false, alreadyIssued: false, existingNomination: null })).toMatchObject({ action: "skip", reason: "comms_paused" });
    expect(recInviteDecision({ electrician: { ...el, email: null }, commsEnabled: true, alreadyIssued: false, existingNomination: null })).toMatchObject({ action: "skip", reason: "no_email" });
    expect(recInviteDecision({ electrician: el, commsEnabled: true, alreadyIssued: false, existingNomination: { business_id: "rec-1", status: "approved", invite_sent_at: null, invite_link_issued_at: null, attempted: false } })).toMatchObject({ action: "skip", reason: "already_onboarded" });
    expect(recInviteDecision({ electrician: el, commsEnabled: true, alreadyIssued: false, existingNomination: { business_id: null, status: "invited", invite_sent_at: "2026-10-01T00:00:00Z", invite_link_issued_at: null, attempted: false } })).toMatchObject({ action: "skip", reason: "nomination_exists" });
    expect(INVITE_SKIP_TEXT.no_email).toBe("No email on file for this electrician — the installer adds it under My business › My usual electrician.");
  });

  test("HV-3193 (Deep): held quote 7e4ab160… with free-text 'ornaldo' A123212 $200 is held 'Electrician not onboarded: ornaldo' on the next sweep and nothing is sent", () => {
    const snapshot: MittiElectricianResolution = { ready: true, choice: "different", priceIncGst: 200, name: "ornaldo", licence: "A123212", source: "mitti_form", reasons: [], needsProfile: false };
    const r = heldQuoteNextSweep({ quote: { status: "draft", sent_at: null }, snapshot, usual: null, candidates: [rec({ worker_licences: ["B999"], rec_number: "REC-1" })], installerBusinessId: "a8304d2d-339b-4cbf-bcf1-fb09ce7935b0", commsEnabled: true });
    expect(r.hold).toBe(true);
    expect(r.reason).toBe("Electrician not onboarded: ornaldo");
    expect(r.resolution.ready).toBe(false);
    expect(r.resolution.priceIncGst).toBeNull();
    expect(r.invite).toMatchObject({ action: "skip", reason: "no_email" }); // free-text record has no email → no invite, no send
    expect(r.sends).toEqual([]);
    // a sent or accepted quote is never touched
    expect(heldQuoteNextSweep({ quote: { status: "issued", sent_at: "2026-10-20T00:00:00Z" }, snapshot, usual: null, candidates: [], installerBusinessId: "x", commsEnabled: true }).hold).toBe(false);
    // once ornaldo's REC is approved with an active rate, the same sweep re-prices at the onboarded rate
    const ok = heldQuoteNextSweep({ quote: { status: "draft", sent_at: null }, snapshot, usual: null, candidates: [rec()], installerBusinessId: "x", commsEnabled: true });
    expect(ok).toMatchObject({ hold: false, reason: null, invite: null });
    expect(ok.resolution).toMatchObject({ ready: true, priceIncGst: 220, source: "approved_rec", recBusinessId: "rec-1" });
    // the snapshot of the free-text quote no longer matches the current (held) resolution, so Send is refused
    expect(mittiQuoteElectricalBlocker([{ code: "PIESA", line_total_inc_gst: 200 }, { code: "AP_FEE", line_total_inc_gst: 349 }], snapshot, r.resolution)).toBe("Ready Check electrician details changed or are incomplete — prepare a new quote");
  });

  test("decision 303 addition — approved REC auto-links to the installers who named it", () => {
    const deep = { installerBusinessId: "a8304d2d-339b-4cbf-bcf1-fb09ce7935b0", installerName: "Deep", usual: null, legacy: [{ jobId: "hv-3193", name: "ornaldo", licence: "A123212" }] };
    // licence match on a legacy price-card block with NO saved usual electrician → link at the REC rate
    const [p1] = autoLinkPlans(rec(), [deep]);
    expect(p1).toMatchObject({ action: "link", via: "legacy", jobIds: ["hv-3193"], electrician: { name: "ornaldo", licence: "A123212", priceIncGst: 220 } });
    // name-only match on a saved usual electrician → re-recorded as the REC at the onboarded rate
    const byName = { installerBusinessId: "inst-2", installerName: "Sam", usual: { name: "Volt Right Electrical", licence: "unknown-1", priceIncGst: 300 }, legacy: [] };
    expect(autoLinkPlans(rec({ worker_licences: [] }), [byName])[0]).toMatchObject({ action: "link", via: "usual", jobIds: [], electrician: { name: "Volt Right Electrical", licence: "unknown-1", priceIncGst: 220 } });
    // conflicting nomination: job names the REC but the saved usual electrician is someone else → office item, nothing changed
    const conflict = { installerBusinessId: "inst-3", installerName: "Kim", usual: { name: "Other Sparks", licence: "Z1", priceIncGst: 300 }, legacy: [{ jobId: "j9", name: "ornaldo", licence: "A123212" }] };
    expect(autoLinkPlans(rec(), [conflict])[0]).toMatchObject({ action: "conflict", jobIds: ["j9"], existing: { name: "Other Sparks" } });
    // no match → nothing; not yet approved / no rate → nothing anywhere
    expect(autoLinkPlans(rec(), [{ installerBusinessId: "inst-4", installerName: "Lee", usual: { name: "Someone", licence: "Q1", priceIncGst: 1 }, legacy: [] }])[0]).toEqual({ action: "none", installerBusinessId: "inst-4" });
    expect(autoLinkPlans(rec({ piesa_rate: null }), [deep])[0]).toEqual({ action: "none", installerBusinessId: deep.installerBusinessId });
    expect(AUTO_LINK_SOURCE).toBe("auto_linked_on_approval");
    expect(recLinkedLine("Volt Right Electrical", "Deep", 1)).toBe("Volt Right Electrical onboarded and linked to Deep — 1 quote ready to check");
    expect(recLinkedLine("Volt Right Electrical", "Deep", 2)).toBe("Volt Right Electrical onboarded and linked to Deep — 2 quotes ready to check");
    expect(recConflictLine("Volt Right Electrical", "Kim")).toContain("has a different usual electrician saved · office to decide");
  });

  test("source guards: pipeline records the hold, only the tick sends the invite, approval/rate activation trigger the auto-link", () => {
    const pipe = read("src/lib/usual-electrician.server.ts");
    expect(pipe).toContain("onboardedElectricianResolution({ legacy, usual: saved?.electrician ?? null, candidates, flatPiesaIncGst: paysOwn?.piesaIncGst ?? null })");
    expect(pipe).toContain("ELECTRICIAN_ONBOARDING_NEEDED_EVENT");
    expect(pipe).not.toMatch(/sendElectricianInvite|office-email\.server|rec-onboarding-invite\.server/);
    expect(read("src/lib/installer-quote.server.ts")).toContain("electrician_not_onboarded: notOnboarded");
    expect(read("src/lib/installer-quote.server.ts")).not.toMatch(/sendElectricianInvite|rec-onboarding-invite\.server/);
    const sweep = read("src/lib/rec-onboarding-invite.server.ts");
    expect(sweep).toContain("recInviteDecision(");
    expect(sweep).toContain('await import("./job-electrician-invite.server")');
    expect(sweep).toContain("customerCommsEnabled()");
    expect(read("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepRecOnboardingInvites");
    expect(read("src/lib/pilot.functions.ts")).toContain('autoLinkApprovedRec(data.businessId, context.userId)');
    expect(read("src/lib/electrician-rates.functions.ts")).toContain('autoLinkApprovedRec(rate.business_id, context.userId)');
    const link = read("src/lib/rec-auto-link.server.ts");
    expect(link).toContain("source: AUTO_LINK_SOURCE");
    expect(link).not.toMatch(/sendElectricianInvite|maybeAutoSendInstallerQuote|releaseQuoteToOwner|sendRealSms|office-email\.server/);
    // the retired free-text path: the price card validates price + inclusions only
    expect(read("src/lib/installer-price.core.ts")).toContain("electrician: null } };");
  });
});
