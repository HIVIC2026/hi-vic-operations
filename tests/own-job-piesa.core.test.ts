import { describe, expect, test } from "bun:test";
import { HOLD_NOT_SIGNED_UP, HOLD_NO_ELECTRICIAN, HOLD_NO_PROFILE, isOwnJobCallAndBook, ownJobHandoffKey, ownJobHandoffPlan } from "@/lib/own-job-piesa.core";

describe("isOwnJobCallAndBook", () => {
  test("installer's own job, not in-house → call and book", () => expect(isOwnJobCallAndBook({ channel: "installer_sourced", heldInHouse: false })).toBe(true));
  test("installer's own job held by an in-house partner → unchanged", () => expect(isOwnJobCallAndBook({ channel: "installer_sourced", heldInHouse: true })).toBe(false));
  test("HIV lead → unchanged", () => expect(isOwnJobCallAndBook({ channel: "hivic_sourced", heldInHouse: false })).toBe(false));
  test("HIV lead held in-house → unchanged", () => expect(isOwnJobCallAndBook({ channel: "hivic_sourced", heldInHouse: true })).toBe(false));
  test("unknown channel → unchanged", () => expect(isOwnJobCallAndBook({ channel: null, heldInHouse: false })).toBe(false));
});

describe("ownJobHandoffPlan", () => {
  const ok = { paid: true, stage: "measured_quote_accepted", electricianBusinessId: "e1", electricianUserId: "u1", alreadyHanded: false };
  test("unpaid → wait", () => expect(ownJobHandoffPlan({ ...ok, paid: false }).kind).toBe("wait"));
  test("paid, no electrician → hold", () => expect(ownJobHandoffPlan({ ...ok, electricianBusinessId: null, electricianUserId: null })).toEqual({ kind: "hold", reason: HOLD_NO_ELECTRICIAN }));
  test("paid, electrician with no profile → hold", () => expect(ownJobHandoffPlan({ ...ok, electricianUserId: null })).toEqual({ kind: "hold", reason: HOLD_NO_PROFILE }));
  test("hold wording is exact", () => { expect(HOLD_NO_ELECTRICIAN).toBe("No electrician chosen for this job"); expect(HOLD_NO_PROFILE).toBe("Electrician has no portal profile"); });
  test("already handed → wait", () => expect(ownJobHandoffPlan({ ...ok, alreadyHanded: true }).kind).toBe("wait"));
  test("wrong stage → wait", () => expect(ownJobHandoffPlan({ ...ok, stage: "piesa_scheduled" }).kind).toBe("wait"));
  test("a new round at the PIESA stage → hand", () => expect(ownJobHandoffPlan({ ...ok, stage: "piesa_and_install_window_pending" })).toEqual({ kind: "hand" }));
  test("nominated electrician not signed up → hold with its own reason", () => expect(ownJobHandoffPlan({ ...ok, electricianBusinessId: null, electricianUserId: null, electricianNotSignedUp: true })).toEqual({ kind: "hold", reason: HOLD_NOT_SIGNED_UP }));
  test("not-signed-up wording is exact", () => expect(HOLD_NOT_SIGNED_UP).toBe("Electrician hasn't finished signing up"));
  test("happy path → hand", () => expect(ownJobHandoffPlan(ok)).toEqual({ kind: "hand" }));
});

describe("ownJobHandoffKey", () => {
  test("one key per job and round", () => {
    expect(ownJobHandoffKey("j1", null)).toBe("own_job_piesa:j1:first");
    expect(ownJobHandoffKey("j1", "2026-11-03T00:00:00Z")).not.toBe(ownJobHandoffKey("j1", null));
  });
});

describe("office item for a hold", () => {
  test("Needs me shows one row with the hold reason", async () => {
    const { needsCandidates } = await import("@/lib/office-needs.core");
    const rows = needsCandidates({ jobId: "j1", jobNumber: "HV-1", surname: "Smith", suburb: "Kew", ownJobPiesaHeld: { at: "2026-11-04T01:00:00Z", reason: HOLD_NO_PROFILE } }, Date.parse("2026-11-04T02:00:00Z"));
    const mine = rows.filter((r) => r.kind === "own_job_piesa_held");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.line).toBe("Safety check (PIESA) not handed to the electrician: Electrician has no portal profile");
  });
});
