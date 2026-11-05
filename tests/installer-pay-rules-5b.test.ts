// Part 5b (Jo 1–5 Nov 2026): installer pay rules per job source.
//  - own customers: "You're paid once the owner has paid in full" — no 7-day wording, due the moment both the paperwork is
//    approved and the owner has paid in full (later of the two)
//  - Home Insulation Victoria leads: "Paid 7 days after Home Insulation Victoria approves the paperwork"
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HIV_LEAD_PAY_HELD_LINE, INSTALLER_PAY_WAITING_AP, INSTALLER_PAY_WAITING_OWNER, OWN_CUSTOMER_PAY_HELD_LINE, installerMoneyHeldLines, installerPayHeldReasons, installerPayRuleLine, payState } from "../src/lib/trade-view.core";
import { MONEY_WORDS, moneyScreen } from "../src/lib/money-screen.core";

describe("pay rule wording per source", () => {
  test("Jo's two lines, no 7-day wording for own customers", () => {
    expect(OWN_CUSTOMER_PAY_HELD_LINE).toBe("You're paid once the owner has paid in full.");
    expect(HIV_LEAD_PAY_HELD_LINE).toBe("Paid 7 days after Home Insulation Victoria approves the paperwork.");
    expect(installerPayRuleLine(true)).toBe(OWN_CUSTOMER_PAY_HELD_LINE);
    expect(installerPayRuleLine(false)).toBe(HIV_LEAD_PAY_HELD_LINE);
    expect(OWN_CUSTOMER_PAY_HELD_LINE).not.toMatch(/7 days|seven days|week/);
    for (const l of [OWN_CUSTOMER_PAY_HELD_LINE, HIV_LEAD_PAY_HELD_LINE, INSTALLER_PAY_WAITING_OWNER]) expect(l).not.toMatch(/\bHIV\b/);
    expect(INSTALLER_PAY_WAITING_OWNER).not.toMatch(/7 days/);
    expect(INSTALLER_PAY_WAITING_AP).toContain("7 days");
  });
  test("Money screen rows use the same two lines", () => {
    expect(MONEY_WORDS.hivicRule).toBe("Paid 7 days after Home Insulation Victoria approves the paperwork");
    expect(MONEY_WORDS.ownRule("Tom")).toBe("You're paid once Tom has paid in full");
    const rows = moneyScreen([
      { jobId: "j1", jobNumber: "HV-1", owner: "Ben Ross", what: "install", amount: 100, ownCustomer: false, state: { kind: "checking" }, ownerFirst: "Ben" },
      { jobId: "j2", jobNumber: "HV-2", owner: "Tom Nguyen", what: "install", amount: 100, ownCustomer: true, state: { kind: "checking" }, ownerFirst: "Tom" },
    ], new Date("2026-11-06T00:00:00Z")).rows;
    expect(rows.find((r) => r.jobId === "j1")?.rule).toBe("Paid 7 days after Home Insulation Victoria approves the paperwork ›");
    expect(rows.find((r) => r.jobId === "j2")?.rule).toBe("You're paid once Tom has paid in full ›");
  });
  test("held lines on the installer Money page follow the source", () => {
    expect(installerMoneyHeldLines({ installerSupplied: true, apApprovedAt: null, ownerPaidInFullAt: null })).toEqual([OWN_CUSTOMER_PAY_HELD_LINE]);
    expect(installerMoneyHeldLines({ installerSupplied: false, apApprovedAt: null, ownerPaidInFullAt: null })).toEqual([HIV_LEAD_PAY_HELD_LINE]);
  });
});

describe("pay timing per source", () => {
  test("own customer: due the moment both the paperwork is approved and the owner has paid in full — no 7 days added", () => {
    const ap = "2026-11-10T00:00:00Z", paid = "2026-11-14T05:00:00Z";
    expect(payState({ paidAt: null, installerSupplied: true, apApprovedAt: ap, ownerPaidInFullAt: paid })).toEqual({ kind: "coming", on: paid });
    expect(payState({ paidAt: null, installerSupplied: true, apApprovedAt: paid, ownerPaidInFullAt: ap })).toEqual({ kind: "coming", on: paid });
    expect(payState({ paidAt: null, installerSupplied: true, apApprovedAt: ap, ownerPaidInFullAt: null }).kind).toBe("checking");
    expect(payState({ paidAt: null, installerSupplied: true, apApprovedAt: null, ownerPaidInFullAt: paid }).kind).toBe("checking");
    expect(installerPayHeldReasons({ installerSupplied: true, apApprovedAt: ap, ownerPaidInFullAt: null })).toEqual([INSTALLER_PAY_WAITING_OWNER]);
  });
  test("Home Insulation Victoria lead: 7 days after approval, never waits for the owner", () => {
    expect(payState({ paidAt: null, installerSupplied: false, apApprovedAt: "2026-11-10T00:00:00Z", ownerPaidInFullAt: null })).toEqual({ kind: "coming", on: "2026-11-17T00:00:00.000Z" });
    expect(payState({ paidAt: null, installerSupplied: false, apApprovedAt: null, ownerPaidInFullAt: null }).kind).toBe("checking");
  });
});

describe("installer-pay-timing.server: one read gives the held reasons and the rule line", () => {
  test("own customer and lead", async () => {
    const rows: Record<string, unknown[]> = {
      jobs: [{ id: "own", channel: "installer_sourced" }, { id: "lead", channel: "hivic_sourced" }],
      workflow_events: [{ job_id: "own", event_type: "stage_changed", to_stage: "ready_for_veec", created_at: "2026-11-10T00:00:00Z" }],
      invoices: [{ job_id: "own", kind: "installation", status: "fully_paid", balance_paid_at: "2026-11-14T05:00:00Z", paid_at: null, updated_at: null }],
    };
    const { memoryPostgrest } = await import("./helpers/memory-postgrest");
    mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: memoryPostgrest(rows as never) }));
    const m = await import("../src/lib/installer-pay-timing.server");
    const own = await m.installerPayTimingFor("own");
    expect(own).toEqual({ installerSupplied: true, held: [], ruleLine: OWN_CUSTOMER_PAY_HELD_LINE, dueAt: "2026-11-14T05:00:00Z" });
    const lead = await m.installerPayTimingFor("lead");
    expect(lead).toEqual({ installerSupplied: false, held: [INSTALLER_PAY_WAITING_AP], ruleLine: HIV_LEAD_PAY_HELD_LINE, dueAt: null });
    await expect(m.installerPayTimingFor("missing")).rejects.toThrow("Job not found");
  });
  test("the read-only module never imports a sender", () => {
    const src = readFileSync("src/lib/installer-pay-timing.server.ts", "utf8");
    expect(src).not.toMatch(/sendGuardedOwnerEmail|sendOfficeEmail|sendRealSms|\.insert\(|\.update\(/);
  });
});
