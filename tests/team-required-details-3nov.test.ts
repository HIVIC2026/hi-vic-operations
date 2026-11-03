// Jo 3 Nov 2:37pm: installers need an Australian mobile + date of birth (email optional); electricians also need email.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TEAM_ERRORS, teamMemberDetails, teamMissingDetails, teamMissingPrompt } from "../src/lib/team-required.core";

const T = "2026-11-03";
const ok = { mobile: "0412 345 678", email: null, dateOfBirth: "1990-01-01" };

test("installer: no mobile is refused", () => {
  expect(teamMemberDetails("installer", { ...ok, mobile: null }, T)).toEqual({ ok: false, error: TEAM_ERRORS.mobile });
});
test("installer: non-Australian mobile is refused", () => {
  expect(teamMemberDetails("installer", { ...ok, mobile: "+44 7700 900123" }, T).ok).toBe(false);
});
test("installer: no date of birth is refused", () => {
  expect(teamMemberDetails("installer", { ...ok, dateOfBirth: null }, T)).toEqual({ ok: false, error: "Add their date of birth for ESC registration." });
});
test("installer: email is optional", () => {
  expect(teamMemberDetails("installer", ok, T)).toEqual({ ok: true, mobile: "+61412345678", email: null, dateOfBirth: "1990-01-01" });
});
test("electrician: no email is refused", () => {
  expect(teamMemberDetails("electrician", ok, T)).toEqual({ ok: false, error: TEAM_ERRORS.email });
});
test("electrician: no date of birth is refused", () => {
  expect(teamMemberDetails("electrician", { ...ok, email: "a@b.au", dateOfBirth: "" }, T).ok).toBe(false);
});
test("electrician: mobile + date of birth + email saves", () => {
  expect(teamMemberDetails("electrician", { ...ok, email: " A@B.au " }, T)).toMatchObject({ ok: true, email: "a@b.au" });
});
test("a typed bad email is refused for anyone", () => {
  expect(teamMemberDetails("installer", { ...ok, email: "nope" }, T)).toEqual({ ok: false, error: TEAM_ERRORS.badEmail });
});
test("existing-person prompts name exactly what is missing", () => {
  expect(teamMissingPrompt("Wayne Fletcher", teamMissingDetails("installer", { mobile: null, email: null, hasDateOfBirth: true }))).toBe("Add Wayne's mobile");
  expect(teamMissingPrompt("Liam Zontanos", teamMissingDetails("installer", { mobile: null, email: null, hasDateOfBirth: false }))).toBe("Add Liam's mobile and date of birth");
  expect(teamMissingPrompt("Peter orlando", teamMissingDetails("electrician", { mobile: "0412345678", email: "p@o.au", hasDateOfBirth: false }))).toBe("Add Peter's date of birth");
  expect(teamMissingPrompt("Sam", teamMissingDetails("electrician", { mobile: null, email: null, hasDateOfBirth: false }))).toBe("Add Sam's mobile, date of birth and email");
  expect(teamMissingDetails("installer", { mobile: "0412345678", email: null, hasDateOfBirth: true })).toEqual([]);
});
test("every business add path uses the shared rule", () => {
  expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).toContain("teamMemberDetails(");
  expect(readFileSync("src/lib/worker-links.functions.ts", "utf8")).toContain("teamMemberDetails(");
  const form = readFileSync("src/routes/_authenticated/field.business_.team.tsx", "utf8");
  expect(form).toContain("teamMemberDetails(");
  expect(form).toContain("teamMissingPrompt(");
});

// Jo 3 Nov ~3pm follow-ups: fill missing details on the Team page; sign-up link asks date of birth.
import { teamFillMissing, joinDateOfBirthProblem } from "../src/lib/team-required.core";
describe("Team page fills missing details (Jo 3 Nov 3pm)", () => {
  const today = "2026-11-03";
  it("saves a missing date of birth for an installer", () => {
    expect(teamFillMissing("installer", { hasDateOfBirth: false, email: null }, { dateOfBirth: "1990-05-01" }, today)).toEqual({ ok: true, dateOfBirth: "1990-05-01", email: null });
  });
  it("refuses a bad or future date of birth", () => {
    expect(teamFillMissing("installer", { hasDateOfBirth: false, email: null }, { dateOfBirth: "2027-01-01" }, today).ok).toBe(false);
  });
  it("never overwrites a date of birth already saved", () => {
    expect(teamFillMissing("electrician", { hasDateOfBirth: true, email: "a@b.co" }, { dateOfBirth: "1990-05-01" }, today)).toEqual({ ok: false, error: "Their date of birth is already saved." });
  });
  it("saves a missing email for an electrician", () => {
    expect(teamFillMissing("electrician", { hasDateOfBirth: true, email: null }, { email: " Pete@Orlando.com.au " }, today)).toEqual({ ok: true, dateOfBirth: null, email: "pete@orlando.com.au" });
  });
  it("installers are never asked for an email here", () => {
    expect(teamFillMissing("installer", { hasDateOfBirth: true, email: null }, { email: "x@y.co" }, today).ok).toBe(false);
  });
  it("refuses a bad email", () => {
    expect(teamFillMissing("electrician", { hasDateOfBirth: true, email: null }, { email: "nope" }, today).ok).toBe(false);
  });
});
describe("Sign-up link asks date of birth (Jo 3 Nov 3pm)", () => {
  it("is required", () => { expect(joinDateOfBirthProblem("", "2026-11-03")).toBe("Add your date of birth."); });
  it("must be valid and before today", () => {
    expect(joinDateOfBirthProblem("2026-11-03", "2026-11-03")).toBe("Your date of birth must be before today.");
    expect(joinDateOfBirthProblem("1990-02-30", "2026-11-03")).toBe("Enter a valid date of birth.");
    expect(joinDateOfBirthProblem("1990-02-28", "2026-11-03")).toBeNull();
  });
});
