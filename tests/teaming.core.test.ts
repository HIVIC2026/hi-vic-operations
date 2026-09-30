import { describe, expect, test } from "bun:test";
import { electricianStepErrors, inviteUsable, pickTeamElectrician, teamStatus } from "../src/lib/teaming.core";

const good = { name: "Sam Spark", email: "sam@spark.com.au", mobile: "0412 345 678", is_primary: true };
describe("team-up rules", () => {
  test("step validation", () => {
    expect(electricianStepErrors({})).toHaveLength(1);
    expect(electricianStepErrors({ electrician_choice: "match" })).toEqual([]);
    expect(electricianStepErrors({ electrician_choice: "have", preferred_electricians: [good], electrician_contact_consent: true })).toEqual([]);
    expect(electricianStepErrors({ electrician_choice: "have", preferred_electricians: [good] }).join()).toContain("agreed to be contacted");
    expect(electricianStepErrors({ electrician_choice: "have", preferred_electricians: [good, { ...good }], electrician_contact_consent: true }).join()).toContain("already listed");
    expect(electricianStepErrors({ electrician_choice: "have", preferred_electricians: [{ ...good, is_primary: false }], electrician_contact_consent: true }).join()).toContain("Main");
  });
  test("status lifecycle", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    expect(teamStatus({ status: "x" }, false, now)).toBe("invite_drafted");
    expect(teamStatus({ status: "x", invite_sent_at: "2026-10-01", invite_expires_at: "2026-10-15" }, false, now)).toBe("sent");
    expect(teamStatus({ status: "x", invite_expires_at: "2026-10-01" }, false, now)).toBe("expired");
    expect(teamStatus({ status: "x", accepted_at: "2026-10-02", invite_expires_at: "2026-10-01" }, false, now)).toBe("signed_up");
    expect(teamStatus({ status: "x", accepted_at: "2026-10-02" }, true, now)).toBe("awaiting_approval");
    expect(teamStatus({ status: "x", accepted_at: "a", teamed_at: "b" }, true, now)).toBe("teamed");
    expect(teamStatus({ status: "x", declined_at: "a" }, false, now)).toBe("declined");
    expect(inviteUsable({ status: "x", invite_expires_at: "2026-10-01" }, now).ok).toBe(false);
  });
  test("pick: main, then backup, never ineligible/out of area", () => {
    const rels = [{ electrician_business_id: "A", is_primary: true, preferred: true, active: true }, { electrician_business_id: "B", is_primary: false, preferred: true, active: true }];
    expect(pickTeamElectrician(rels, [{ id: "A", eligible: true, inArea: true }])).toEqual({ id: "A", via: "primary" });
    expect(pickTeamElectrician(rels, [{ id: "A", eligible: false, inArea: true }, { id: "B", eligible: true, inArea: true }])).toEqual({ id: "B", via: "backup" });
    expect(pickTeamElectrician(rels, [{ id: "A", eligible: true, inArea: false }, { id: "B", eligible: true, inArea: false }])).toBeNull();
    expect(pickTeamElectrician([{ ...rels[0]!, active: false }], [{ id: "A", eligible: true, inArea: true }])).toBeNull();
  });
});
