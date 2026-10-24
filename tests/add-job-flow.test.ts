import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADD_JOB_STEPS, FORM_WITHIN_15, NEUTRAL_SAVE_ERROR, SAVE_LABEL, VISIT_FIELD_LABEL, formLabel, nextStep, outcomeFor, prevStep, restoreCustomer, saveErrorMessage, visitPayload, visitProblems, visitSummary } from "../src/lib/add-job-flow.core";
import { onsiteProblems } from "../src/lib/onsite-ready-check.core";

describe("Add job flow (Jo 8 Oct; basics only since decision 34, 24 Oct)", () => {
  test("two steps in order, back from customer exits", () => {
    expect(ADD_JOB_STEPS.map((s) => s.label)).toEqual(["Customer", "Review & save"]);
    expect(nextStep("customer")).toBe("review");
    expect(prevStep("review")).toBe("customer"); expect(prevStep("customer")).toBeNull();
  });
  test("restored phone draft keeps typed values but never the consent tick", () => {
    const r = restoreCustomer({ full_name: "TEST Owner", postcode: "3000", contact_permission: true, consent_by: "installer" });
    expect(r.full_name).toBe("TEST Owner"); expect(r.postcode).toBe("3000");
    expect(r.contact_permission).toBe(false); expect(r.consent_by).toBeNull();
  });
  test("ACT postcode still refused", () => expect(onsiteProblems({ ...restoreCustomer({}), postcode: "2604" })).toContain("We can only take Victorian jobs — this one can't be added"));
  test("save label never says Start or Book", () => expect(SAVE_LABEL).toBe("Add job"));
  test("duplicate email errors become the neutral office line", () => {
    expect(saveErrorMessage('duplicate key value violates unique constraint "owners_email_uq"')).toBe(NEUTRAL_SAVE_ERROR);
    expect(saveErrorMessage("This email is already on another customer record. Contact the office")).toBe(NEUTRAL_SAVE_ERROR);
  });
  test("form state uses the server's own reason", () => {
    expect(formLabel({ kind: "open", url: "x" }).label).toBe("Form available");
    expect(formLabel({ kind: "preparing", message: "p" }).label).toBe("Preparing form");
    expect(formLabel({ kind: "retry", message: "Your Mitti login isn't linked yet." })).toEqual({ label: "Form unavailable", detail: "Your Mitti login isn't linked yet." });
  });
  test("decision 116: the visit field is optional; blank books nothing, half-filled is refused, never guessed", () => {
    expect(VISIT_FIELD_LABEL).toBe("Ready Check visit day and time (optional)");
    expect(visitPayload({ day: "", time: "" })).toBeNull();
    expect(visitProblems({ day: "", time: "" })).toEqual([]);
    expect(visitProblems({ day: "2026-11-02", time: "" })).toHaveLength(1);
    expect(visitPayload({ day: "2026-11-02", time: "09:00" })).toEqual({ day: "2026-11-02", time: "09:00" });
    expect(visitSummary({ day: "", time: "" })).toContain("not entered");
    expect(visitSummary({ day: "2026-11-02", time: "09:00" })).toContain("9am");
  });
  test("outcome: saving is never shown as a booking; the form is promised within 15 minutes, a booking only when confirmed", () => {
    const w = outcomeFor({ booking: "none", state: { kind: "preparing", message: "p" } });
    expect(w.tone).toBe("waiting"); expect(w.body).toBe(FORM_WITHIN_15); expect(w.visit).toBeNull();
    expect(outcomeFor({ booking: "confirmed", state: { kind: "open", url: "x" } })).toMatchObject({ tone: "success", visit: expect.stringContaining("6:30am") });
    expect(outcomeFor({ booking: "blocked", state: { kind: "preparing", message: "p" } }).visit).toContain("enter the time on the job");
    const b = outcomeFor({ booking: "none", state: { kind: "office", message: "Office must set up the form." } });
    expect(b.tone).toBe("blocked"); expect(b.heading).toContain("not ready");
  });
  test("page: basics + permission tick + one optional visit field; no mode choice, measurements, price, files or electrician (decision 34)", () => {
    const ui = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");
    for (const h of ["startOnsiteReadyCheck", "READY_CHECK_CONTACT_PERMISSION", "VisitField", "visitPayload(visit)", "Open Mitti form"]) expect(ui).toContain(h);
    for (const gone of ["AttachFiles", "ElectricianPicker", "confirmImport", "createImport", "datetime-local", "Ceiling area", "quoted price", 'mode === "onsite"', "I'm at the property now", "A job for later"]) expect(ui).not.toContain(gone);
    expect(readFileSync("src/routes/_authenticated/partner.import.tsx", "utf8")).toContain("<AddJobFlow businessId={businessId}");
  });
  test("old /partner/add still redirects", () => expect(readFileSync("src/routes/_authenticated/partner.add.tsx", "utf8")).toContain('redirect({ to: "/partner/import"'));
});

import { READY_CHECK_CONTACT_PERMISSION } from "../src/lib/job-electrician.core";
test("consent wording is Jo's exact text and an unticked box blocks progress", () => {
  expect(READY_CHECK_CONTACT_PERMISSION).toBe("The owner has given Home Insulation Victoria permission to contact them for the eligibility assessment.");
  const c = { ...restoreCustomer({ full_name: "TEST Owner", address_line: "1 Test St", suburb: "Melbourne", postcode: "3000", phone: "0400000000", email: "t@example.test", contact_permission: true, consent_by: "installer" }) };
  expect(c.contact_permission).toBe(false);
  expect(onsiteProblems(c).some((m) => /permission/.test(m))).toBe(true);
  expect(onsiteProblems({ ...c, contact_permission: true, consent_by: "installer" }).some((m) => /permission/.test(m))).toBe(false);
});
