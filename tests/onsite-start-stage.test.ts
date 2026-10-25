// Decision 314 follow-up (stage machinery): an A4 whose ONLY repair tick is "Be on site at the start of the install day"
// clears on `electrician_at_start` (fixes quote accepted + payment rule cleared) and then advances straight to
// installation_scheduling and is bookable — the open fixes items are done on the install day (never marked completed),
// no A5 fixes form and no fixes booking. Every other job keeps its old routing and entry blockers.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { planStep, type AdvanceFacts } from "../src/lib/autoadvance.core";
import { electricalClearance, installEntryElectricalBlockers, onsiteStartAtInstall, FIXES_NOT_COMPLETED_BLOCKER, PASSING_PIESA_BLOCKER } from "../src/lib/allocation.core";
import { onsiteStartOnly, fixesTimesNeeded } from "../src/lib/fixes-times.core";
import { fixesFormNeeded } from "../src/lib/fixes-day.core";
import { FIXES_ONSITE_OPTION, FIXES_RCD_OPTION, RECTIFICATION_OUTCOMES } from "../src/lib/official-short.core";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const base: AdvanceFacts = { eligibilityConfirmed: true, electricianAssigned: true, assessmentBookingConfirmed: false, openRectItems: 0, rectQuoteIssued: false, rectQuoteAccepted: false, installQuotesIssued: true, installQuoteAccepted: true, consumerSigned: true, invoiceExists: true, depositCleared: true, rectBookingConfirmed: false, installBookingConfirmed: false, installationCompleted: false, installerDeclarationSigned: false, veecLodged: false };

const short = (ticks: string[]) => ({ rectificationOutcome: RECTIFICATION_OUTCOMES[2], rectificationComplete: "No", fixesWork: ticks.join(", ") });
const onsiteShort = short([FIXES_ONSITE_OPTION]);
const mixedShort = short([FIXES_ONSITE_OPTION, FIXES_RCD_OPTION]);
const clearance = { piesaOutcome: "fail" as const, piesaCompletedAt: "2026-10-01", rectificationRequired: true, rectificationQuoteAccepted: true, rectificationCompletedAt: null, sectionCSignedAt: null, fixesPaymentCleared: true };

describe("on-site-only job: accepted + paid fixes quote → straight to installation scheduling, bookable", () => {
  const cleared = electricalClearance({ ...clearance, onsiteStartOnly: onsiteStartOnly(onsiteShort) });
  const f: AdvanceFacts = { ...base, openRectItems: 1, rectQuoteAccepted: true, onsiteStartOnly: true, onsiteStartCleared: onsiteStartAtInstall(cleared) };
  test("the A4 answer is on-site-only and clears on electrician_at_start", () => {
    expect(onsiteStartOnly(onsiteShort)).toBe(true);
    expect(cleared).toMatchObject({ cleared: true, basis: "electrician_at_start" });
    expect(onsiteStartAtInstall(cleared)).toBe(true);
  });
  test("payment, PIESA complete and a job already in rectification_scheduling all go to installation_scheduling", () => {
    for (const s of ["awaiting_deposit_payment", "piesa_complete", "rectification_scheduling"] as const) expect(planStep(s, f)).toMatchObject({ kind: "transition", to: "installation_scheduling" });
  });
  test("entry to installation_scheduling / installation_booked: open fixes items + recorded PIESA do not block", () => {
    expect(installEntryElectricalBlockers({ openRectItems: 1, piesaDate: "2026-10-01", piesaOutcome: "fail", onsiteStartCleared: true })).toEqual([]);
    // Still needs a current PIESA.
    expect(installEntryElectricalBlockers({ openRectItems: 1, piesaDate: null, piesaOutcome: null, onsiteStartCleared: true })).toEqual([PASSING_PIESA_BLOCKER]);
  });
  test("no A5 fixes form and no fixes times are needed", () => {
    expect(fixesFormNeeded(onsiteShort)).toBe(false);
    expect(fixesTimesNeeded(onsiteShort)).toBe(false);
  });
  test("before the fixes quote is accepted and paid: waits, never routes to a fixes visit", () => {
    const waiting: AdvanceFacts = { ...f, onsiteStartCleared: false };
    expect(onsiteStartAtInstall(electricalClearance({ ...clearance, onsiteStartOnly: true, fixesPaymentCleared: false }))).toBe(false);
    expect(planStep("awaiting_deposit_payment", waiting)).toMatchObject({ kind: "stop" });
    expect(planStep("rectification_scheduling", waiting)).toMatchObject({ kind: "stop" });
    expect(installEntryElectricalBlockers({ openRectItems: 1, piesaDate: "2026-10-01", piesaOutcome: "fail", onsiteStartCleared: false })).toEqual([FIXES_NOT_COMPLETED_BLOCKER, PASSING_PIESA_BLOCKER]);
  });
});

describe("on site + another repair: still needs the fixes visit", () => {
  const c = electricalClearance({ ...clearance, onsiteStartOnly: onsiteStartOnly(mixedShort) });
  const f: AdvanceFacts = { ...base, openRectItems: 2, rectQuoteAccepted: true, onsiteStartOnly: false, onsiteStartCleared: onsiteStartAtInstall(c) };
  test("not on-site-only, not cleared, fixes form + times needed", () => {
    expect(onsiteStartOnly(mixedShort)).toBe(false);
    expect(c.cleared).toBe(false);
    expect(f.onsiteStartCleared).toBe(false);
    expect(fixesFormNeeded(mixedShort)).toBe(true);
    expect(fixesTimesNeeded(mixedShort)).toBe(true);
  });
  test("routes to rectification_scheduling and waits for the fixes booking", () => {
    expect(planStep("awaiting_deposit_payment", f)).toMatchObject({ kind: "transition", to: "rectification_scheduling" });
    expect(planStep("rectification_scheduling", f)).toEqual({ kind: "stop", reason: "Electrical fixes booking not confirmed" });
    expect(planStep("piesa_complete", f)).toMatchObject({ kind: "stop" });
    expect(installEntryElectricalBlockers({ openRectItems: 2, piesaDate: "2026-10-01", piesaOutcome: "fail", onsiteStartCleared: f.onsiteStartCleared })).toContain(FIXES_NOT_COMPLETED_BLOCKER);
  });
});

describe("normal fixes job and no-fixes job: unchanged", () => {
  const f: AdvanceFacts = { ...base, openRectItems: 1, rectQuoteAccepted: true };
  test("fixes job: rectification_scheduling → booked → installation once items are done", () => {
    expect(planStep("awaiting_deposit_payment", f)).toMatchObject({ kind: "transition", to: "rectification_scheduling" });
    expect(planStep("rectification_scheduling", f)).toEqual({ kind: "stop", reason: "Electrical fixes booking not confirmed" });
    expect(planStep("rectification_scheduling", { ...f, rectBookingConfirmed: true })).toMatchObject({ kind: "transition", to: "rectification_booked" });
    expect(planStep("rectification_booked", f)).toEqual({ kind: "stop", reason: "Electrical fixes not yet completed" });
    expect(planStep("rectification_booked", { ...f, openRectItems: 0 })).toMatchObject({ kind: "transition", to: "installation_scheduling" });
    expect(planStep("piesa_complete", f)).toEqual({ kind: "stop", reason: "Electrical fixes listed at the PIESA – Home Insulation Victoria must route the electrical fixes" });
    expect(installEntryElectricalBlockers({ openRectItems: 1, piesaDate: "2026-10-01", piesaOutcome: "pass" })).toEqual([FIXES_NOT_COMPLETED_BLOCKER]);
  });
  test("no-fixes job: passing PIESA required exactly as before", () => {
    expect(planStep("awaiting_deposit_payment", base)).toMatchObject({ kind: "transition", to: "installation_scheduling" });
    expect(installEntryElectricalBlockers({ openRectItems: 0, piesaDate: "2026-10-01", piesaOutcome: "pass" })).toEqual([]);
    expect(installEntryElectricalBlockers({ openRectItems: 0, piesaDate: "2026-10-01", piesaOutcome: "fail" })).toEqual([PASSING_PIESA_BLOCKER]);
    expect(FIXES_NOT_COMPLETED_BLOCKER).toBe("Electrical fixes not yet completed.");
    expect(PASSING_PIESA_BLOCKER).toBe("A passing PIESA / electrical sign-off is required before installation.");
  });
  test("a stray on-site flag without open items changes nothing", () => {
    expect(planStep("awaiting_deposit_payment", { ...base, onsiteStartCleared: true, onsiteStartOnly: true })).toMatchObject({ to: "installation_scheduling", summary: "Payment option verified – installation scheduling unlocked" });
  });
});

describe("source pins", () => {
  test("stageEntryBlockers uses the pure rule and reads the clearance only when fixes items are open; items are never completed", () => {
    const s = read("src/lib/workflow.server.ts");
    expect(s).toContain("blockers.push(...installEntryElectricalBlockers({ openRectItems: rect, piesaDate: piesa?.piesa_date, piesaOutcome: piesa?.piesa_outcome, onsiteStartCleared }));");
    expect(s).toContain('const onsiteStartCleared = rect > 0 ? await (await import("./electrical-clearance.server")).onsiteStartClearedFor(jobId) : false;');
    expect(s).toContain('rectification_scheduling: ["rectification_booked", "installation_scheduling"],');
    const a = read("src/lib/autoadvance.server.ts");
    expect(a).toContain("if (rect > 0) {");
    const e = read("src/lib/electrical-clearance.server.ts");
    // Lean module: no senders, Xero or Mitti in the stage/auto-advance import graph.
    const imports = [...e.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./allocation.core", "./fixes-times.core", "./official-short.core", "./workflow.server", "@/integrations/supabase/client.server"]);
    expect(read("src/lib/allocation.server.ts")).toContain('export { clearanceFacts } from "./electrical-clearance.server";');
    expect(a + s + e).not.toMatch(/rectification_items"\)\.update/);
  });
});
