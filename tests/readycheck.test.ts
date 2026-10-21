import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "fs";
import {
  READY_CHECK_BOOKING_SUCCESS, READY_CHECK_FEE, READY_CHECK_STAGES, READY_CHECK_PAID_NEXT_ACTION, READY_CHECK_PAID_STAGE, TEST_REC_RATE_CARD, UNPRICEABLE_COPY,
  checkPiesaWindow, computeElectricalAllowance, installDeadline, measuredQuote, readyCheckRemaining,
  reconcilePiesa, usableRateCard, validateObservations, MEASURED_QUOTE_LABELS,
} from "../src/lib/readycheck.core";
import { CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_QUOTE_ORDER, CUSTOMER_READY_CHECK, customerQuoteRows } from "../src/lib/customer-quote-system";
import { TRANSITIONS } from "../src/lib/workflow.server";

const obs = { "elec.downlight_count": 8, "elec.downlight_type": "halogen", "elec.rcd_visible": "not_visible", "elec.unusual_condition": true } as const;
const migration = readFileSync("drizzle/migrations/0043_ready_check_workflow.sql", "utf8");
const server = readFileSync("src/lib/readycheck-payment.server.ts", "utf8");
const workflow = readFileSync("src/lib/workflow.server.ts", "utf8");
const booking = readFileSync("src/lib/booking.server.ts", "utf8");
const pilotFunctions = readFileSync("src/lib/pilot.functions.ts", "utf8");
const portalFunctions = readFileSync("src/lib/portal.functions.ts", "utf8");

describe("free Ready Check", () => {
  test("free request is idempotent and legacy $99 records remain auditable", () => {
    expect(READY_CHECK_FEE).toBe(0);
    expect(migration).toContain("UNIQUE (job_id, estimate_id)");
    expect(readyCheckRemaining(3716.24)).toBe(3716.24);
    expect(server).not.toContain("apply_ready_check_test_payment");
  });
  test("Ready Check always costs $0 and never reduces the project balance", () => {
    expect(READY_CHECK_FEE).toBe(0);
    expect(readyCheckRemaining(3716.24, 99)).toBe(3716.24);
  });
  test("payment advances once to scheduling, never PIESA/Xero/invoice/deposit", () => {
    expect(READY_CHECK_PAID_STAGE).toBe("ready_check_ready_to_schedule");
    expect(READY_CHECK_PAID_NEXT_ACTION).toBe("Assign Installer and arrange Ready Check");
    for (const banned of ["xero", "invoice", "deposit", "piesa_scheduled", "quotes"]) expect(server.toLowerCase().includes(`from("${banned}`)).toBe(false);
    expect(server).not.toMatch(/xero\.server|invoice\.lifecycle/);
  });
  test("old $349-first path is removed", () => {
    expect(existsSync("src/lib/assessment-payment.server.ts")).toBe(false);
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.accept_pre_assessment_test");
    const surfaces = ["src/components/portal/estimate.tsx", "src/lib/estimate-email.ts", "src/lib/followup-email.ts", "src/routes/estimate.$token.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(surfaces).not.toMatch(/\$349 payable now|PAY \$349|LET.S GET STARTED|Measure \+ PIESA payment/);
    expect(CUSTOMER_READY_CHECK.cta).toBe("BOOK MY READY CHECK →");
  });
});

describe("customer copy", () => {
  test("preliminary order, no electrical allowance", () => {
    expect(CUSTOMER_QUOTE_ORDER).toEqual([
      "Mandatory Pre Insulation Electrical Safety Assessment (PIESA)", "R5.0 ceiling insulation — supply & install",
      "Home Insulation Victoria — Accredited Person Management", "Estimated project total", "Estimated VEU / VEEC discount",
      "YOUR ESTIMATED COST AFTER DISCOUNT",
    ]);
    expect(customerQuoteRows({ installation: 1, piesa: 2, apManagement: 3 }).map((r) => r.key)).toEqual(["piesa", "insulation", "apManagement"]);
    expect(JSON.stringify(CUSTOMER_QUOTE_LABELS)).not.toMatch(/allowance/i);
    expect(CUSTOMER_PAYMENT_COPY.credited).toBe("Your Ready Check is free.");
    expect(CUSTOMER_READY_CHECK.paragraphs).toContain("The Ready Check is not the mandatory Pre Insulation Electrical Safety Assessment (PIESA). Your PIESA is completed later by a licensed electrician, close to installation.");
  });
});

describe("workflow", () => {
  test("no manual electrician review between Ready Check and measured quote", () => {
    expect(TRANSITIONS.ready_check_complete).toEqual(["measured_estimate_ready"]);
    expect(READY_CHECK_STAGES.some((s) => /review|electrician/.test(s))).toBe(false);
  });
  test("Ready Check does not start PIESA", () => {
    for (const s of ["ready_check_ready_to_schedule", "ready_check_scheduled", "ready_check_complete", "measured_estimate_ready"] as const) expect(TRANSITIONS[s]?.some((t) => t.startsWith("piesa"))).toBe(false);
  });
  test("installer assignment and booking details precede Ready Check scheduled", () => {
    expect(workflow).toContain('to === "ready_check_scheduled"');
    expect(workflow).toContain('eq("role", "installer")');
    expect(workflow).toContain('eq("kind", "ready_check")');
    expect(workflow).toContain("Record the Ready Check date, time, assigned installer and installer business");
    expect(booking).toContain('ready_check: [["ready_check_ready_to_schedule", "ready_check_scheduled"], "ready_check_scheduled"]');
    expect(booking).toContain("assignment_id: contractor.id");
    expect(booking).toContain("business_id: contractor.business_id");
    expect(booking).toContain('kind === "installation" || kind === "ready_check" ? "installer" : "electrician"');
    expect(booking).toContain("requireApprovedPartner");
    expect(portalFunctions).toContain("Do not assign an electrician for the Ready Check");
  });
  test("installer-led contact and follow-up are recorded without sending", () => {
    expect(pilotFunctions).toContain("recordReadyCheckContact");
    expect(pilotFunctions).toContain("ready_check_contact_recorded");
    expect(pilotFunctions).toContain("Follow up Ready Check contact or reassign installer");
    expect(pilotFunctions).not.toContain("sendReadyCheck");
  });
  test("payment success copy names the certified installer-led booking step", () => {
    expect(READY_CHECK_BOOKING_SUCCESS.heading).toBe("YOUR READY CHECK IS BOOKING NEXT");
    expect(READY_CHECK_BOOKING_SUCCESS.assignment).toContain("Installer");
    expect(READY_CHECK_BOOKING_SUCCESS.assignment).toContain("will contact you");
  });
});

describe("observations", () => {
  test("installers cannot set PIESA/compliance", () => {
    expect(validateObservations({ "elec.piesa_result": "pass" }).join()).toMatch(/cannot record PIESA/);
    expect(validateObservations({ "elec.rcd_compliant": true }).join()).toMatch(/cannot record PIESA/);
    expect(migration).toMatch(/field_key !~\* '\(piesa\|pass\|fail\|complian/);
    expect(validateObservations({ "elec.downlight_count": 2.5 }).join()).toMatch(/non-negative integer/);
  });
});

describe("allowance engine", () => {
  test("deterministic, itemised, preliminary only", () => {
    const a = computeElectricalAllowance(obs, TEST_REC_RATE_CARD, 1);
    expect(computeElectricalAllowance(obs, TEST_REC_RATE_CARD, 1)).toEqual(a);
    expect(a.preliminary_only).toBe(true);
    expect(a.lines.map((l) => [l.code, l.amountIncGst])).toEqual([["DL_HALOGEN_REPLACE", 440], ["RCD_NOT_VISIBLE", 280]]);
    expect(a.preliminary_electrical_allowance_total).toBe(720);
    expect(a.unpriceable.map((u) => u.code)).toEqual(["UNUSUAL_CONDITION"]);
    expect(a.rate_card_version).toBe(1);
  });
  test("conservative allowance when unconfirmed", () => {
    const a = computeElectricalAllowance({ "elec.downlight_type": "unable_to_confirm" }, TEST_REC_RATE_CARD, 1);
    expect(a.lines[0]).toMatchObject({ code: "DL_UNCONFIRMED", quantity: 4, amountIncGst: 220 });
  });
  test("test card refused in production; no live rates seeded", () => {
    expect(usableRateCard(TEST_REC_RATE_CARD, false)).toBeNull();
    expect(usableRateCard(TEST_REC_RATE_CARD, true)).not.toBeNull();
    const all = readdirSync("drizzle/migrations").filter((f) => f.endsWith(".sql")).map((f) => readFileSync(`drizzle/migrations/${f}`, "utf8")).join("\n");
    expect(all).not.toMatch(/INSERT INTO public\.rec_rate_card/i);
  });
});

describe("measured quote", () => {
  test("canonical order, unpriceable does not block, free Ready Check changes no totals", () => {
    const a = computeElectricalAllowance(obs, TEST_REC_RATE_CARD, 1);
    const q = measuredQuote({ insulation: 4500, removal: 2250, access: 0, allowance: a, piesa: 349, ap: 349, discount: 1481.76, readyCheckPaid: true });
    const L = MEASURED_QUOTE_LABELS;
    expect(q.rows.map((r) => r.label)).toEqual([L.insulation, L.removal, L.allowance, L.piesa, L.apManagement, L.projectTotal, L.discount, L.finalCost, L.remaining]);
    expect(q.gross).toBe(8168);
    expect(q.costAfter).toBe(6686.24);
    expect(q.remaining).toBe(6686.24);
    expect(q.unpriceable).toBe(true);
    expect(UNPRICEABLE_COPY).toBe("Additional electrical work may be required — unable to estimate from the preliminary observations.");
  });
});

describe("PIESA reconciliation", () => {
  const a = computeElectricalAllowance(obs, TEST_REC_RATE_CARD, 1);
  test("same / lower / higher", () => {
    const same = reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 8 }, { code: "RCD_NOT_VISIBLE", quantity: 1 }], TEST_REC_RATE_CARD, a);
    expect([same.outcome, same.variance, same.requires_customer_approval]).toEqual(["same", 0, false]);
    const lower = reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 6 }], TEST_REC_RATE_CARD, a);
    expect([lower.outcome, lower.customer_adjustment, lower.requires_customer_approval]).toEqual(["lower", -390, false]);
    const higher = reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 8 }, { code: "RCD_NOT_VISIBLE", quantity: 1 }, { code: "SWB_CERAMIC", quantity: 1 }], TEST_REC_RATE_CARD, a);
    expect([higher.outcome, higher.variance, higher.requires_customer_approval]).toEqual(["higher", 650, true]);
  });
  test("unmatched items need approval", () => {
    expect(reconcilePiesa([{ code: "UNKNOWN", quantity: 1 }], TEST_REC_RATE_CARD, a).requires_customer_approval).toBe(true);
  });
});

describe("30-day window", () => {
  test("deadline, hard warning, buffer, re-PIESA", () => {
    expect(installDeadline("2026-10-01T03:00:00Z")).toBe("2026-10-31");
    expect(checkPiesaWindow({ planned_piesa_date: null, planned_install_date: "2026-11-02", piesa_completed_at: "2026-10-01", today: "2026-10-05" }).hardWarning).toMatch(/new PIESA/);
    expect(checkPiesaWindow({ planned_piesa_date: "2026-10-01", planned_install_date: "2026-10-10", piesa_completed_at: null, today: "2026-09-30" })).toMatchObject({ hardWarning: null, bufferWarning: null, readyForPiesa: true });
    expect(checkPiesaWindow({ planned_piesa_date: "2026-10-01", planned_install_date: "2026-10-03", piesa_completed_at: null, today: "2026-09-30" }).bufferWarning).toMatch(/7–14/);
    expect(checkPiesaWindow({ planned_piesa_date: "2026-10-01", planned_install_date: null, piesa_completed_at: null, today: "2026-09-30" }).readyForPiesa).toBe(true); // Jo 7 Oct: no paired install slot needed
    expect(checkPiesaWindow({ planned_piesa_date: null, planned_install_date: null, piesa_completed_at: "2026-10-01", today: "2026-11-05" }).newPiesaRequired).toBe(true);
  });
});
