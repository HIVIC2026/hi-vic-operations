// Task 7 (installer screens): Add a job — the approved form, the consent tick naming the installer, the per-job electrician.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADD_JOB_WORDS, addJobConsentLine, addJobConsentRecord, addJobStartState, consentProblem, electricianProblem, nextLine, fieldErrors } from "../src/lib/add-job-flow.core";
import { LEAD_ORIGINS, LEAD_ORIGIN_BLOCKED, leadOriginProblem, onsiteProblems, type OnsiteInput } from "../src/lib/onsite-ready-check.core";
import { CONSENT_PURPOSE } from "../src/lib/contact-consent-record.core";

const read = (p: string) => readFileSync(p, "utf8");
const good: OnsiteInput = { full_name: "Sarah Brown", address_line: "18 Dixie Street", suburb: "Richmond", postcode: "3121", phone: "0412 345 678", email: "sarah@example.com", contact_permission: true, consent_by: "installer" };

describe("Add a job — approved words", () => {
  test("ADD_JOB_WORDS is the approved set and nextLine names the owner", () => {
    expect(ADD_JOB_WORDS).toEqual({
      title: "Add a job", sub: "Your own customer. Takes a minute.", name: "Owner's full name", mobile: "Mobile", email: "Email", address: "Address",
      how: "How did you get this customer?", howNote: "Door-knocked or cold-called customers can't be added.", electrician: "Electrician for the PIESA", button: "Add the job",
    });
    expect(nextLine("Tom")).toBe("Next: call Tom and book the Ready Check on the job.");
  });
  test("first lead-origin label is the mock-up's; door-knock and cold call are still refused", () => {
    expect(LEAD_ORIGINS[0]).toEqual({ value: "owner_contacted", label: "They contacted us" });
    expect(leadOriginProblem("door_knock")).toBe(LEAD_ORIGIN_BLOCKED);
    expect(leadOriginProblem("cold_call")).toBe(LEAD_ORIGIN_BLOCKED);
    expect(leadOriginProblem("owner_contacted")).toBeNull();
  });
});

describe("Add a job — the consent tick names the installer", () => {
  test("the line names Home Insulation Victoria and the business", () => {
    expect(addJobConsentLine("Rapid Insulation")).toBe("The owner has agreed to Home Insulation Victoria and Rapid Insulation contacting them about this job.");
  });
  test("unticked → onsiteProblems includes that line's problem; ticked by the installer → clear", () => {
    const p = consentProblem("Rapid Insulation");
    expect(p).toContain("Home Insulation Victoria and Rapid Insulation");
    expect(onsiteProblems({ ...good, contact_permission: false, consent_by: null }, { businessName: "Rapid Insulation" })).toContain(p);
    expect(onsiteProblems({ ...good, contact_permission: true, consent_by: null }, { businessName: "Rapid Insulation" })).toContain(p);
    expect(onsiteProblems(good, { businessName: "Rapid Insulation" })).toEqual([]);
    expect(fieldErrors([p]).permission).toBeTruthy();
  });
  test("the record keeps Part 3's consent shape and the brief's event details", () => {
    const r = addJobConsentRecord("Rapid Insulation", "2026-11-03T05:00:00Z");
    expect(r.event).toEqual({ wording: addJobConsentLine("Rapid Insulation"), who: ["Home Insulation Victoria", "Rapid Insulation"], for: "this job", how: ["phone", "visit"], given_at: "2026-11-03T05:00:00Z", recorded_by: "installer" });
    expect(r.snapshot.who).toEqual(["Home Insulation Victoria", "Rapid Insulation"]);
    expect(r.snapshot.purpose).toBe(CONSENT_PURPOSE);
    expect(r.snapshot.methods).toEqual(["phone", "visit"]);
    expect(r.snapshot.wording).toBe(addJobConsentLine("Rapid Insulation"));
    expect(r.snapshot.expiresAt).toMatch(/^2027-02-03T/);
  });
  test("the save refuses without the tick, before anything is written", () => {
    const srv = read("src/lib/onsite-ready-check.server.ts");
    const body = srv.slice(srv.indexOf("export async function startOnsiteReadyCheckFor"));
    expect(body.indexOf("onsiteProblems(input, { businessName")).toBeGreaterThan(-1);
    expect(body.indexOf("if (problems.length) throw")).toBeLessThan(body.indexOf("findAddedJob("));
    expect(body).toContain("addJobConsentRecord(");
    expect(body).not.toContain("OWNER_CONTACT_PERMISSION");
  });
});

describe("Add a job — the electrician for the PIESA", () => {
  test("no electrician chosen → one problem (DRAFT); a listed, allowed one → clear", () => {
    const list = [{ id: "e1", name: "Will", allowed: true, reason: null }, { id: "e2", name: "Not Yet", allowed: false, reason: "Waiting for office approval" }];
    expect(electricianProblem(null, list)).toBe("Choose the electrician for the PIESA.");
    expect(electricianProblem("", list)).toBe("Choose the electrician for the PIESA.");
    expect(electricianProblem("e2", list)).toBe("Waiting for office approval");
    expect(electricianProblem("zzz", list)).toBe("Choose the electrician for the PIESA.");
    expect(electricianProblem("e1", list)).toBeNull();
    expect(electricianProblem("e1", [])).toBeTruthy();
    expect(fieldErrors(["Choose the electrician for the PIESA."]).electrician).toBe("Choose the electrician for the PIESA.");
  });
  test("the save takes a required electricianWorkerId, checks it before saving and allocates after the job exists", () => {
    const srv = read("src/lib/onsite-ready-check.server.ts");
    const body = srv.slice(srv.indexOf("export async function startOnsiteReadyCheckFor"));
    expect(body).toContain("electricianWorkerId");
    expect(body.indexOf("electricianProblem(")).toBeLessThan(body.indexOf("findAddedJob("));
    expect(body.indexOf("allocateElectrician(")).toBeGreaterThan(body.indexOf("findAddedJob("));
    expect(body.indexOf("allocateElectrician(")).toBeLessThan(body.indexOf("onReadyCheckJobAdded("));
    expect(body).not.toContain("readUsualElectricianStatus");
    expect(body).not.toContain("tradeSetReadyCheckTime");
    const fns = read("src/lib/onsite-ready-check.functions.ts");
    expect(fns).toContain("electricianWorkerId: uuid");
    expect(fns).not.toContain("electricianChoice:");
  });
  test("boss and Office may add; the Office sign-in starts the form too", () => {
    expect(addJobStartState(new Map([["b2", "business_admin"]]))).toEqual({ kind: "owner", businessId: "b2" });
    expect(addJobStartState(new Map([["b1", "member"]]))).toEqual({ kind: "staff" });
    expect(addJobStartState(new Map([["b1", "member"]]), { businessId: "b1", prices: true })).toEqual({ kind: "owner", businessId: "b1" });
    const srv = read("src/lib/onsite-ready-check.server.ts");
    expect(srv).toContain("pricesOrThrow(");
    expect(srv).not.toContain("requireMember(userId, businessId, true)");
  });
});

describe("Add a job — the screen", () => {
  const ui = read("src/components/trade/add-job-flow.tsx");
  const page = read("src/routes/_authenticated/partner.import.tsx");
  test("the old cards and the Job added outcome are gone; success goes to the job page", () => {
    for (const gone of ["VISIT_CARD", "Home Insulation Victoria's electrician", "We arrange the electrical safety check", "addedView", "SavedResult", "data-saved", "electricianChoiceOptions", "VisitField"]) expect(ui, gone).not.toContain(gone);
    expect(ui).toContain('to: "/field/$jobId"');
    expect(ui).toContain("nextLine(");
    // fix wave minor 15: the "Next: call {first}…" line is on the job page too, not toast-only
    expect(ui).toContain("search: { added: true }");
    const job = read("src/routes/_authenticated/field.$jobId.tsx");
    expect(job).toContain("validateSearch");
    expect(job).toContain("data-added-next");
    expect(job).toContain("nextLine(page.ownerFirst");
    expect(ui).toContain("ADD_JOB_WORDS.button");
    expect(ui).not.toContain("data-electrician-picker"); // Jo 6 Nov 2026: picked on the job page before the PIESA
    expect(ui).toContain("ADD_JOB_WORDS.howNote");
    expect(ui).toContain("addJobConsentLine(");
  });
  test("the page shows the approved title and sub", () => {
    expect(page).toContain("ADD_JOB_WORDS.title");
    expect(page).toContain("ADD_JOB_WORDS.sub");
    expect(page).not.toContain("ADD_JOB_LEAD");
  });
  test("A1 still creates the Ready Check Mitti form at once through the claim-guarded creator", () => {
    const srv = read("src/lib/onsite-ready-check.server.ts");
    expect(srv).toContain('const { onReadyCheckJobAdded } = await import("./mitti-create.server")');
  });
});

describe("fix round 1 — fieldErrors routing", () => {
  test("the consent problem routes to the permission line even when the business is called '…Electrician…'", () => {
    const p = consentProblem("Bright Electrician Co");
    const e = fieldErrors([p]);
    expect(e.permission).toBeTruthy();
    expect(e.electrician).toBeUndefined();
  });
});
