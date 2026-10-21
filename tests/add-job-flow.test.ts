import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADD_JOB_STEPS, NEUTRAL_SAVE_ERROR, bookingLabel, existingDetailsProblems, existingReviewProblems, formLabel, laterDetailsProblems, nextStep, prevStep, restoreCustomer, saveErrorMessage, submitLabel } from "../src/lib/add-job-flow.core";
import { onsiteProblems } from "../src/lib/onsite-ready-check.core";

const ex = { area: "120", method: "laser", amount: "3,450", includes: "R5 batts" };
describe("Add job flow (Jo 8 Oct)", () => {
  test("three steps in order, back from customer exits", () => {
    expect(ADD_JOB_STEPS.map((s) => s.label)).toEqual(["Customer", "Job details", "Review & save"]);
    expect(nextStep("customer")).toBe("details"); expect(nextStep("details")).toBe("review");
    expect(prevStep("review")).toBe("details"); expect(prevStep("customer")).toBeNull();
  });
  test("restored phone draft keeps typed values but never the consent tick", () => {
    const r = restoreCustomer({ full_name: "TEST Owner", postcode: "3000", contact_permission: true, consent_by: "installer" });
    expect(r.full_name).toBe("TEST Owner"); expect(r.postcode).toBe("3000");
    expect(r.contact_permission).toBe(false); expect(r.consent_by).toBeNull();
  });
  test("ACT postcode still refused", () => expect(onsiteProblems({ ...restoreCustomer({}), postcode: "2604" })).toContain("We can only take Victorian jobs — this one can't be added"));
  test("existing quoted job needs measurements and exact quote facts only", () => {
    expect(existingDetailsProblems(ex)).toEqual([]);
    expect(existingDetailsProblems({ ...ex, amount: "" })).toContain("Enter the quote amount inc GST");
  });
  test("previously agreed price is optional for already-visited intake", () => {
    expect(existingReviewProblems({ feeAwareness: true, belowR2: true, ownerAgreed: false })).toEqual([]);
    expect(existingReviewProblems({ feeAwareness: true, belowR2: true, ownerAgreed: true })).toEqual([]);
  });
  test("fee awareness remains required without prior price agreement", () => {
    expect(existingReviewProblems({ feeAwareness: false, belowR2: true, ownerAgreed: false })).toEqual(["Tick that the owner knows about the fees"]);
  });
  test("below-R2 confirmation remains required without prior price agreement", () => {
    expect(existingReviewProblems({ feeAwareness: true, belowR2: false, ownerAgreed: false })).toEqual(["Tick that any existing insulation is below R2.0"]);
  });
  test("later job needs the booked date; manual area needs a method", () => {
    expect(laterDetailsProblems({ date: "", manual: false, area: "", method: "", notes: "" })).toContain("Enter the booked Ready Check date and time");
    expect(laterDetailsProblems({ date: "2026-10-12T09:00", manual: true, area: "150", method: "", notes: "" })).toContain("Tell us how the ceiling area was measured");
  });
  test("save labels never say Start", () => {
    expect(submitLabel("onsite")).toBe("Save job and prepare Ready Check form");
    expect(submitLabel("later")).toBe("Save job for later"); expect(submitLabel("existing")).toBe("Add job");
  });
  test("duplicate email errors become the neutral office line", () => {
    expect(saveErrorMessage('duplicate key value violates unique constraint "owners_email_uq"')).toBe(NEUTRAL_SAVE_ERROR);
    expect(saveErrorMessage("This email is already on another customer record. Contact the office")).toBe(NEUTRAL_SAVE_ERROR);
  });
  test("form state uses the server's own reason", () => {
    expect(formLabel({ kind: "open", url: "x" }).label).toBe("Form available");
    expect(formLabel({ kind: "preparing", message: "p" }).label).toBe("Preparing form");
    expect(formLabel({ kind: "retry", message: "Your Mitti login isn't linked yet." })).toEqual({ label: "Form unavailable", detail: "Your Mitti login isn't linked yet." });
  });
  test("blocked appointment is never shown as confirmed", () => {
    expect(bookingLabel("blocked")).toBe("Appointment saved but not confirmed — the office will check it");
    expect(bookingLabel("confirmed")).toBe("Appointment confirmed");
  });
  test("flow reuses one draft and keeps guarded handlers", () => {
    const ui = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");
    expect(ui).toContain("if (draft) return draft;");
    for (const h of ["confirmImport", "startOnsiteReadyCheck", "createImport"]) expect(ui).toContain(h);
    expect(ui).not.toContain("Yes skips our Ready Check");
  });
  test("old /partner/add still redirects", () => expect(readFileSync("src/routes/_authenticated/partner.add.tsx", "utf8")).toContain('redirect({ to: "/partner/import"'));
});

import { READY_CHECK_CONTACT_PERMISSION } from "../src/lib/job-electrician.core";
test("onsite/later consent wording is Jo's exact text and an unticked box blocks progress", () => {
  expect(READY_CHECK_CONTACT_PERMISSION).toBe("The owner has given Home Insulation Victoria permission to contact them for the eligibility assessment.");
  const c = { ...restoreCustomer({ full_name: "TEST Owner", address_line: "1 Test St", suburb: "Melbourne", postcode: "3000", phone: "0400000000", email: "t@example.test", contact_permission: true, consent_by: "installer" }) };
  expect(c.contact_permission).toBe(false);
  expect(onsiteProblems(c).some((m) => /permission/.test(m))).toBe(true);
  expect(onsiteProblems({ ...c, contact_permission: true, consent_by: "installer" }).some((m) => /permission/.test(m))).toBe(false);
});
