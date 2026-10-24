import { describe, expect, it } from "bun:test";
import { mittiReadyCheckStage } from "@/lib/mitti-pickup.core";
import { planStep } from "@/lib/autoadvance.core";
import { PRE_READY_CHECK_STAGES } from "@/lib/installer-new-jobs.core";
import { MITTI_READY_CHECK_STAGES, MITTI_STAGE_GUARD_MESSAGE, createOrReuseAudit, readyCheckFormStageAllowed } from "@/lib/mitti.core";
import { autoFormDecision, isStageFailure, type AutoFormFacts } from "@/lib/mitti-autoform.core";

describe("Installer-led Mitti jobs wait on the installer (Jo 23 Oct)", () => {
  it("early stages move to ready_check_scheduled, never 'No reply'", () => {
    expect(mittiReadyCheckStage({ stage: "preliminary_estimate_ready", channel: "installer_sourced" })).toBe("ready_check_scheduled");
    expect(mittiReadyCheckStage({ stage: "new_enquiry", channel: "installer_sourced" })).toBe("ready_check_scheduled");
  });
  it("HIV leads and later stages are untouched", () => {
    expect(mittiReadyCheckStage({ stage: "preliminary_estimate_ready", channel: "hivic_sourced" })).toBeNull();
    expect(mittiReadyCheckStage({ stage: "ready_check_complete", channel: "installer_sourced" })).toBeNull();
    expect(mittiReadyCheckStage({ stage: "ready_check_scheduled", channel: "installer_sourced" })).toBeNull();
  });
  it("auto-advance never moves a ready_check_scheduled job", () => {
    expect(planStep("ready_check_scheduled" as never, {} as never).kind).toBe("stop");
  });
});

// Jo 24 Oct 2026 (HV-3151): Reinsulate added a job; the website checks parked it at "estimate sent – waiting for the
// owner to save their spot"; the automatic form attempt was refused by the Mitti stage guard and then waited a day.
describe("HV-3151: the automatic sweep, the office button and the Mitti stage guard agree", () => {
  const now = new Date("2026-10-23T09:00:00Z");
  const facts: AutoFormFacts = { channel: "installer_sourced", stage: "new_enquiry", createdAt: "2026-10-23T06:33:00Z", deleted: false, archived: false, hasCurrentMeasurement: false, installerUserId: "u1", mittiInvited: true, templateSet: true, autoSendMitti: true, lastFailureAt: null };
  it("every stage the sweep creates a form in is accepted by the guard for an installer's own customer", () => {
    for (const stage of PRE_READY_CHECK_STAGES) {
      expect(autoFormDecision({ ...facts, stage }, now, true)).toEqual({ action: "create" });
      expect(readyCheckFormStageAllowed(stage, "installer_sourced")).toBe(true);
    }
  });
  it("our leads keep the two scheduling stages; quote and later stages are refused for everyone", () => {
    for (const stage of PRE_READY_CHECK_STAGES) expect(readyCheckFormStageAllowed(stage, "hivic_sourced")).toBe((MITTI_READY_CHECK_STAGES as readonly string[]).includes(stage));
    for (const stage of ["ready_check_complete", "measured_estimate_ready", "measured_quote_accepted", "piesa_scheduled", "complete"]) {
      expect(readyCheckFormStageAllowed(stage, "installer_sourced")).toBe(false);
      expect(readyCheckFormStageAllowed(stage, "hivic_sourced")).toBe(false);
    }
  });
  it("the guard refuses an installer job outside the pre-Ready-Check stages with the known message", async () => {
    const api = { searchUsers: async () => { throw new Error("must not reach Mitti"); } } as never;
    const base = { businessUnit: "hivic", jobNumber: "HV-3151", existingAuditId: null, electricianEmail: "i@example.test", templateId: "template_0123456789abcdef0123456789abcdef", assigneeRole: "installer" as const, channel: "installer_sourced", prefill: {} as never };
    await expect(createOrReuseAudit(api, { ...base, stage: "measured_estimate_ready" })).rejects.toThrow(MITTI_STAGE_GUARD_MESSAGE);
    await expect(createOrReuseAudit(api, { ...base, stage: "preliminary_estimate_ready", channel: "hivic_sourced" })).rejects.toThrow(MITTI_STAGE_GUARD_MESSAGE);
    // Past the guard (HV-3151's stage): the next check is the Mitti user lookup, i.e. the stage was accepted.
    await expect(createOrReuseAudit(api, { ...base, stage: "preliminary_estimate_ready" })).rejects.toThrow("must not reach Mitti");
    expect(isStageFailure(MITTI_STAGE_GUARD_MESSAGE)).toBe(true);
  });
  it("auto-advance sends an installer's own customer to Ready Check ready to schedule, never 'save their spot'", () => {
    const f = { eligibilityConfirmed: false, installerSourced: true } as never;
    for (const stage of ["new_enquiry", "eligibility_review", "preliminary_estimate_ready"]) expect(planStep(stage as never, f)).toMatchObject({ kind: "transition", to: "ready_check_ready_to_schedule" });
    expect(planStep("new_enquiry" as never, { eligibilityConfirmed: true, installerSourced: true } as never)).toMatchObject({ to: "ready_check_ready_to_schedule" });
    // Our leads are unchanged: Gate 1 first, then wait for the owner to save their spot.
    expect(planStep("new_enquiry" as never, { eligibilityConfirmed: false } as never).kind).toBe("stop");
    expect(planStep("new_enquiry" as never, { eligibilityConfirmed: true } as never)).toMatchObject({ to: "preliminary_estimate_ready" });
    expect(planStep("preliminary_estimate_ready" as never, { eligibilityConfirmed: true } as never).kind).toBe("stop");
    expect(mittiReadyCheckStage({ stage: "ready_check_ready_to_schedule", channel: "installer_sourced" })).toBe("ready_check_scheduled"); // and once the form exists it waits on the installer
  });
});
