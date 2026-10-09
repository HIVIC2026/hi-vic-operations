import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { TRANSITIONS } from "../src/lib/workflow.server";
import { RETIRED_LEGACY_STAGES, isRetiredStage, retiredStageBlocker, STAGE_LABEL, type Stage } from "../src/lib/workflow";
import { planStep } from "../src/lib/autoadvance.core";
import { MITTI_ASSIGN_STAGES } from "../src/lib/mitti.core";

// Stages that represent a quote, booking, PIESA or electrician assessment.
const TARGETS = new Set<string>([
  "awaiting_electrician", "assessment_booking", "assessment_booked", "assessment_complete",
  "piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "electrical_variation_pending",
  "rectification_required", "rectification_scheduling", "rectification_booked",
  "measured_estimate_ready", "measured_quote_accepted", "ready_for_installer_quotes", "awaiting_quote_acceptance",
  "installation_scheduling", "installation_booked",
]);

/** Every simple route from new_enquiry to a target stage, with retired-stage entries removed (server blocker). */
function routes() {
  const out: Stage[][] = [];
  const walk = (path: Stage[]) => {
    const at = path[path.length - 1]!;
    if (TARGETS.has(at)) out.push([...path]);
    for (const n of TRANSITIONS[at] ?? []) {
      if (path.includes(n) || retiredStageBlocker(n)) continue;
      walk([...path, n]);
    }
  };
  walk(["new_enquiry"]);
  return out;
}

const src = (p: string) => readFileSync(p, "utf8");

describe("legacy electrician-assessment path retired", () => {
  test("every valid route reaches Ready Check completion before any quote/booking/PIESA stage", () => {
    const all = routes();
    // Jo 8 Oct installer-intake commercial route: measured_estimate_ready straight from eligibility, guarded server-side
    // (Ready Check measure-up or installer-intake readiness blockers); Ready Check evidence is deferred, never waived.
    const intakeRoute = (r: Stage[]) => { const i = r.indexOf("measured_estimate_ready"); return i > 0 && ["new_enquiry", "eligibility_review"].includes(r[i - 1]!); };
    const w = src("src/lib/workflow.server.ts");
    expect(w).toContain('if (to === "measured_estimate_ready" && (await (await import("./installer-intake.server")).isIntakeJob(jobId))) {');
    expect(w).toContain("Free Ready Check eligibility measure-up not yet completed by the installer.");
    const bad = all.filter((r) => !r.slice(0, -1).includes("ready_check_complete") && !intakeRoute(r));
    console.log(`route proof: ${all.length - bad.length} of ${all.length} pass through ready_check_complete`);
    expect(all.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  test("no route ever enters a retired stage", () => {
    for (const r of routes()) for (const s of r) expect(isRetiredStage(s)).toBe(false);
    expect(TRANSITIONS.new_enquiry).not.toContain("awaiting_electrician");
    expect(TRANSITIONS.eligibility_review).not.toContain("awaiting_electrician");
    expect(TRANSITIONS.awaiting_electrician).not.toContain("assessment_booking");
  });

  test("server blocker refuses stale/replayed entry into each retired stage", () => {
    for (const s of RETIRED_LEGACY_STAGES) expect(retiredStageBlocker(s)).toContain(STAGE_LABEL[s]);
    expect(retiredStageBlocker("ready_check_complete")).toBeNull();
    const wf = src("src/lib/workflow.server.ts");
    expect(wf).toContain("const retired = retiredStageBlocker(to);");
    expect(wf.indexOf("retiredStageBlocker(to)")).toBeLessThan(wf.indexOf("readyCheckBlockers(jobId, to)));"));
  });

  test("stranded legacy jobs have an exit back to the Ready Check", () => {
    for (const s of ["awaiting_electrician", "assessment_booking", "assessment_booked"] as Stage[]) expect(TRANSITIONS[s]).toContain("ready_check_ready_to_schedule");
  });

  test("auto-progression never advances through legacy stages", () => {
    const f = { electricianAssigned: true, assessmentBookingConfirmed: true } as never;
    expect(planStep("awaiting_electrician", f).kind).toBe("stop");
    expect(planStep("assessment_booking", f).kind).toBe("stop");
    expect(planStep("assessment_booked", f).kind).toBe("stop");
  });

  test("office assignment, choose-your-electrician and Team Up no longer push into Assessment Booking", () => {
    for (const p of ["src/lib/portal.functions.ts", "src/lib/pilot.functions.ts", "src/lib/teaming.server.ts"])
      expect(src(p)).not.toMatch(/transition\([^)]*"assessment_booking"/);
    expect(src("src/lib/teaming.server.ts")).toContain('if (stage !== "piesa_and_install_window_pending") return false;');
  });

  test("legacy 'assessment' appointments/bookings are only the payment-gated PIESA visit", () => {
    for (const p of ["src/lib/pilot.functions.ts", "src/lib/booking.server.ts"]) {
      expect(src(p)).toContain('["piesa_and_install_window_pending", "piesa_scheduled"]');
      expect(src(p)).toContain("piesaRequestBlockers(await piesaRequestFacts(");
    }
  });

  test("Mitti PIESA forms are created only in the Ready Check-first PIESA stages", () => {
    expect([...MITTI_ASSIGN_STAGES]).toEqual(["piesa_and_install_window_pending", "piesa_scheduled"]);
  });

  test("resume from hold cannot re-enter a retired stage", () => {
    const p = src("src/lib/portal.functions.ts");
    expect(p).toContain("const retired = retiredStageBlocker(job.prior_stage);");
    expect(p).toContain("if (isRetiredStage(before.prior_stage)) before.prior_stage = \"eligibility_review\";");
  });

  test("trade/owner UI no longer offers legacy appointment or assessment booking actions", () => {
    const field = src("src/routes/_authenticated/field.$jobId.tsx");
    expect(field).not.toContain("<AppointmentPanel");
    expect(field).toContain('["piesa_and_install_window_pending"].includes(job.stage!) && !job.electrician_name && <ElectricianChoicePanel');
    expect(src("src/routes/_authenticated/owner.$jobId.tsx")).toContain(": null; // legacy assessment bookings retired");
  });

  test("legacy stages stay readable in history", () => {
    for (const s of RETIRED_LEGACY_STAGES) expect(STAGE_LABEL[s].length).toBeGreaterThan(0);
  });
});
