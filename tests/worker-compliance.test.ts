import { describe, expect, test } from "bun:test";
import { CREW_CLEARANCE_REASON, approvalFlags, crewClearance, licenceState, licenceWarning, missingItems, piisaState, workerOfferBlocker } from "../src/lib/worker-compliance.core";
import { stepErrors as recErrors } from "../src/lib/rec-onboarding.core";
import { stepErrors as instErrors } from "../src/lib/installer-onboarding.core";
const T = "2026-10-06";
const sp = (e: string | null) => ({ trade_role: "electrician", licence_expires_on: e });
describe("electrician licence expiry", () => {
  test("states", () => {
    expect(licenceState(null, T)).toBe("missing");
    expect(licenceState("2026-10-05", T)).toBe("expired");
    expect(licenceState("2026-11-01", T)).toBe("lapses_30");
    expect(licenceState("2026-11-30", T)).toBe("lapses_60");
    expect(licenceState("2027-06-01", T)).toBe("ok");
  });
  test("approval flags expired / within 60 days", () => {
    expect(approvalFlags(sp("2026-10-01"), T)).toContain("Licence expired");
    expect(approvalFlags(sp("2026-11-30"), T)).toContain("Licence expires within 60 days");
    expect(approvalFlags(sp("2027-06-01"), T)).toEqual([]);
  });
  test("warning from 30 days, block once expired", () => {
    expect(licenceWarning(sp("2026-11-30"), T)).toBeNull();
    expect(licenceWarning(sp("2026-11-01"), T)).toContain("26 days");
    expect(workerOfferBlocker(sp("2026-11-01"), T)).toBeNull();
    expect(workerOfferBlocker(sp("2026-10-05"), T)).toBe("Electrical licence has expired.");
  });
  test("existing electricians show missing with Add it, not blocked", () => {
    expect(missingItems(sp(null))).toEqual(["licence_expiry"]);
    expect(workerOfferBlocker(sp(null), T)).toBeNull();
  });
  test("REC form requires the expiry date", () => {
    const base = { works_under_rec: false, primary_contact_name: "Sam", contact_is_licensed_electrician: true, licence_number: "A1", business_phone: "0412345678", business_email: "sam@sparky.com.au" } as never;
    expect(recErrors("about" as never, base)).toContain("Enter your licence expiry date.");
    expect(recErrors("about" as never, { ...(base as object), licence_expiry: "2028-01-01" } as never)).not.toContain("Enter your licence expiry date.");
  });
});
describe("crew clearance (decision 153, Jo 24 Oct 2026)", () => {
  const ok = { certStatus: "verified", level: "full", expiresOn: "2028-01-01" };
  test("verified CII + recorded level + unexpired = cleared; approval_status plays no part", () => {
    expect(crewClearance(ok, T)).toEqual({ cleared: true, reason: null });
    expect(crewClearance({ ...ok, level: "provisional" }, T).cleared).toBe(true);
    expect(crewClearance({ ...ok, expiresOn: T }, T).cleared).toBe(true); // expires today still counts today
  });
  test("each missing fact blocks on its own, fail closed", () => {
    expect(crewClearance({ ...ok, certStatus: null }, T).reason).toBe(CREW_CLEARANCE_REASON.unverified);
    expect(crewClearance({ ...ok, certStatus: "rejected" }, T).reason).toBe(CREW_CLEARANCE_REASON.withdrawn);
    expect(crewClearance({ ...ok, level: null }, T).reason).toBe(CREW_CLEARANCE_REASON.noLevel);
    expect(crewClearance({ ...ok, expiresOn: null }, T).reason).toBe(CREW_CLEARANCE_REASON.noLevel);
    expect(crewClearance({ ...ok, expiresOn: "2026-10-05" }, T).reason).toBe(CREW_CLEARANCE_REASON.expired);
    expect(crewClearance({ ...ok, removed_at: "2026-10-01T00:00:00Z" }, T).reason).toBe(CREW_CLEARANCE_REASON.removed);
  });
  test("office flags: verified without level, or expired, is called out; undefined level facts never invent a flag", () => {
    const v = { trade_role: "installer", certification_status: "verified" as const, piisa_status: "done" as const, piisa_certificate_path: "p", piisa_verified_at: "2026-10-01" };
    expect(approvalFlags(v, T)).toEqual([]);
    expect(approvalFlags({ ...v, cii_level: null, cii_expires_on: null }, T)).toEqual(["CII level and expiry to record"]);
    expect(approvalFlags({ ...v, cii_level: "full", cii_expires_on: "2026-10-01" }, T)).toEqual(["CII certificate expired"]);
    expect(approvalFlags({ ...v, cii_level: "full", cii_expires_on: "2028-01-01" }, T)).toEqual([]);
  });
});
describe("installer PIISA training", () => {
  const inst = (x: object) => ({ trade_role: "installer", ...x });
  test("No: can submit, flagged, blocked until verified", () => {
    const w = inst({ piisa_status: "not_done" });
    expect(approvalFlags(w, T)).toContain("PIISA training not done");
    expect(workerOfferBlocker(w, T)).not.toBeNull();
  });
  test("uploaded but unverified still blocked; verified ok", () => {
    expect(piisaState(inst({ piisa_status: "done", piisa_certificate_path: "x" }))).toBe("awaiting_check");
    expect(workerOfferBlocker(inst({ piisa_status: "done", piisa_certificate_path: "x" }), T)).not.toBeNull();
    expect(workerOfferBlocker(inst({ piisa_status: "done", piisa_certificate_path: "x", piisa_verified_at: "2026-10-06" }), T)).toBeNull();
  });
  test("existing installers show missing with Add it", () => expect(missingItems(inst({}))).toEqual(["piisa"]));
  test("form: Yes needs date + certificate; No passes the PIISA check", () => {
    const one = (x: object) => ({ installers: [{ full_legal_name: "Al", mobile: "0412345678", email: "al@ins.com.au", cii_holds: "not_held", ...x }] }) as never;
    const errs = (x: object) => instErrors("installers" as never, one(x)).join(" | ");
    expect(errs({})).toContain("PIISA training");
    expect(errs({ piisa_done: "no" })).not.toContain("PIISA");
    expect(errs({ piisa_done: "yes" })).toContain("Enter the date they finished PIISA training.");
    expect(errs({ piisa_done: "yes", piisa_date: "2026-09-01" })).toContain("Upload the PIISA certificate.");
    expect(errs({ piisa_done: "yes", piisa_date: "2026-09-01", piisa_uploaded: true })).not.toContain("PIISA");
  });
});
