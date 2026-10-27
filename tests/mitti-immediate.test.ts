import { describe, expect, it } from "bun:test";
import { immediateSkipReason, immediateOutcomeNote, immediateNoteSummary } from "../src/lib/mitti-immediate.core";

const ok = { auditId: null, measurementComplete: false, installerUserId: "u", mittiInvited: true, templateSet: true, autoSend: true, gateADone: true };

describe("instant Ready Check form on Add a job", () => {
  it("starts when every switch allows it", () => expect(immediateSkipReason(ok)).toBeNull());
  it("names the reason for each skip", () => {
    expect(immediateSkipReason(null)).toBe("job not found");
    expect(immediateSkipReason({ ...ok, auditId: "a" })).toBe("a Mitti form is already on the job");
    expect(immediateSkipReason({ ...ok, installerUserId: null })).toBe("no active installer is assigned");
    expect(immediateSkipReason({ ...ok, mittiInvited: false })).toBe("the installer's business is not invited to Mitti");
    expect(immediateSkipReason({ ...ok, templateSet: false })).toBe("no Mitti Ready Check form template is set");
    expect(immediateSkipReason({ ...ok, autoSend: false })).toBe("automatic Mitti forms are switched off");
  });
  it("notes every stop except a created form", () => {
    expect(immediateOutcomeNote("created")).toBeNull();
    for (const o of ["held", "uncertain", "failed"] as const) expect(immediateOutcomeNote(o)).not.toBeNull();
  });
  it("says the tick is the backup", () => expect(immediateNoteSummary("x")).toContain("15-minute check will try again"));
});
