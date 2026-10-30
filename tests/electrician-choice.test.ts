// Decision 289 (Jo 25 Oct 2026): the electrician is chosen ONCE at Add a job and never asked again. Pure rules + wiring.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ELECTRICIAN_CHOICE_EVENT, ELECTRICIAN_CHOICE_HIVIC, ELECTRICIAN_CHOICE_ISSUES, ELECTRICIAN_CHOICE_QUESTION, defaultElectricianChoice, electricianChoiceFromEvent, electricianChoiceLine, electricianChoiceOptions, electricianChoiceProblem, electricianChoiceRecord, resolveElectricianChoice, addJobUsual, addJobElectricianProblem,
} from "../src/lib/electrician-choice.core";
import { addedView, fieldErrors } from "../src/lib/add-job-flow.core";
import { usualIsOnboarded } from "../src/lib/rec-onboarded.core";

const usual = { name: "Sam Lee", licence: "A12345", priceIncGst: 300 };

describe("Add a job: one required choice, usual electrician only when set, default = usual when set", () => {
  test("options and default with a usual electrician saved", () => {
    expect(electricianChoiceOptions(usual)).toEqual([{ value: "usual", label: "My usual electrician (Sam Lee)" }, { value: "hivic", label: "Home Insulation Victoria's electrician" }]);
    expect(defaultElectricianChoice(usual)).toBe("usual");
    expect(ELECTRICIAN_CHOICE_QUESTION).toBe("Electrical safety check by");
    expect(ELECTRICIAN_CHOICE_HIVIC).toBe("Home Insulation Victoria's electrician");
  });
  test("options and default without one: HIV only, and 'usual' is refused (set them in My business first)", () => {
    expect(electricianChoiceOptions(null)).toEqual([{ value: "hivic", label: "Home Insulation Victoria's electrician" }]);
    expect(defaultElectricianChoice(null)).toBe("hivic");
    expect(electricianChoiceProblem("usual", null)).toBe(ELECTRICIAN_CHOICE_ISSUES.usual);
    expect(electricianChoiceProblem(null, usual)).toBe(ELECTRICIAN_CHOICE_ISSUES.missing);
    expect(electricianChoiceProblem("hivic", null)).toBeNull();
    expect(electricianChoiceProblem("usual", usual)).toBeNull();
    // No "a different electrician" path any more.
    expect(electricianChoiceOptions(usual).map((o) => o.value)).not.toContain("different");
  });
  test("the problem lands on its own field line on Add a job", () => {
    expect(fieldErrors([ELECTRICIAN_CHOICE_ISSUES.missing]).electrician).toBe(ELECTRICIAN_CHOICE_ISSUES.missing);
    expect(fieldErrors([ELECTRICIAN_CHOICE_ISSUES.usual]).electrician).toBe(ELECTRICIAN_CHOICE_ISSUES.usual);
    expect(fieldErrors(["Enter the owner's full name"]).electrician).toBeUndefined();
  });
  test("the 'Job added' screen names the usual electrician when chosen", () => {
    const base = { jobNumber: "HV-1", address: "1 St", ownerName: "Ann Lee", phone: "04", ownerFirstName: "Ann", booking: "none" as const, visit: { day: "", time: "" }, state: undefined };
    expect(addedView({ ...base, electrician: { choice: "usual", usualName: "Sam Lee" } }).steps[2]).toBe("Sam Lee does the electrical safety check once Ann accepts.");
    expect(addedView({ ...base, electrician: { choice: "hivic", usualName: "Sam Lee" } }).steps[2]).toBe("We arrange the electrical safety check once Ann accepts.");
    expect(addedView(base).steps[2]).toBe("We arrange the electrical safety check once Ann accepts.");
  });
});

describe("the event and the one resolver the quote pipeline reads", () => {
  test("record shape and read-back; malformed → null", () => {
    expect(electricianChoiceRecord("usual", usual, "add_job")).toEqual({ choice: "usual", usual_name: "Sam Lee", usual_licence: "A12345", source: "add_job" });
    expect(electricianChoiceRecord("hivic", usual, "bulk_upload")).toEqual({ choice: "hivic", usual_name: null, usual_licence: null, source: "bulk_upload" });
    expect(electricianChoiceFromEvent({ choice: "usual" })).toBe("usual");
    expect(electricianChoiceFromEvent({ choice: "different" })).toBeNull();
    expect(electricianChoiceFromEvent(null)).toBeNull();
    expect(ELECTRICIAN_CHOICE_EVENT).toBe("electrician_choice_set");
  });
  test("recorded choice first; an old form / old price-card answer next; then usual electrician, then HIV (never undecided)", () => {
    expect(resolveElectricianChoice({ recorded: "hivic", legacy: "different", usual })).toBe("hivic");
    expect(resolveElectricianChoice({ recorded: null, legacy: "different", usual })).toBe("different");
    expect(resolveElectricianChoice({ recorded: null, legacy: "own", usual })).toBe("usual"); // unknown legacy wording → the default rule
    expect(resolveElectricianChoice({ recorded: null, legacy: null, usual })).toBe("usual");
    expect(resolveElectricianChoice({ recorded: null, legacy: null, usual: null })).toBe("hivic");
  });
  test("read-only line", () => {
    expect(electricianChoiceLine("usual", usual)).toBe("My usual electrician (Sam Lee)");
    expect(electricianChoiceLine("usual", null)).toContain("not saved yet");
    expect(electricianChoiceLine("hivic", usual)).toBe("Home Insulation Victoria's electrician");
    expect(electricianChoiceLine("different", usual, "Jo Volt")).toBe("A different electrician (Jo Volt)");
  });
});

describe("wiring (source facts)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("Add a job: the question is on the one screen, sent to the existing guarded handler, recorded once as the event", () => {
    const ui = read("src/components/trade/add-job-flow.tsx");
    expect(ui).toContain("data-electrician-choice");
    expect(ui).toContain("electricianChoiceOptions(pickable)");
    expect(ui).toContain("setElectrician(defaultElectricianChoice(pickable))");
    expect(ui).toContain("electricianChoice: choice }");
    const fn = read("src/lib/onsite-ready-check.functions.ts");
    expect(fn).toContain('electricianChoice: z.enum(["hivic", "usual"]).nullable().optional()');
    expect(fn).toContain("export const addJobOptions = createServerFn");
    expect(fn).not.toContain("@tanstack/react-start/server");
    const srv = read("src/lib/onsite-ready-check.server.ts");
    expect(srv).toContain("addJobElectricianProblem(electricianChoice, status)");
    expect(srv).toContain('recordElectricianChoice(job.id, businessId, userId, electricianChoice, "add_job")');
    expect(srv.indexOf("if (problems.length) throw")).toBeLessThan(srv.indexOf("recordElectricianChoice("));
  });
  test("bulk upload / Add one job: default usual-else-HIV, no new column", () => {
    const s = read("src/lib/partner-import.server.ts");
    expect(s).toContain('recordElectricianChoice(res.job_id, imp.business_id, context.userId, null, "bulk_upload")');
    expect(read("src/lib/electrician-choice.server.ts")).toContain("const chosen = choice ?? defaultElectricianChoice(usual);");
    expect(read("src/lib/electrician-choice.server.ts")).not.toMatch(/\.update\(|sendRealSms|mitti\.server/);
  });
  test("quote pipeline: mittiElectricianForJob reads the recorded choice first, legacy answers next, then the default; chase never asks", () => {
    const s = read("src/lib/usual-electrician.server.ts");
    expect(s).toContain("readElectricianChoice(jobId)");
    expect(s).toContain("resolveElectricianChoice({ recorded, legacy: answers.electricianChoice, usual: saved?.electrician ?? null })");
    expect(s).not.toContain('if (answers.electricianChoice !== "hivic" && answers.electricianChoice !== "usual" && answers.electricianChoice !== "different") return null;');
    expect(read("src/lib/ready-check-chase.server.ts")).toContain("electricianDecided: true,");
  });
});

test("A3: a saved but not-onboarded usual electrician is not offered, not the default, and refused", () => {
  const off = { name: "Sam Lee", onboarded: false }, on = { name: "Sam Lee", onboarded: true };
  expect(electricianChoiceOptions(addJobUsual(off)).map((o) => o.value)).toEqual(["hivic"]);
  expect(defaultElectricianChoice(addJobUsual(off))).toBe("hivic");
  expect(addJobElectricianProblem("usual", off)).toBe(ELECTRICIAN_CHOICE_ISSUES.notOnboarded);
  expect(addJobElectricianProblem("usual", on)).toBeNull();
  expect(addJobElectricianProblem("usual", null)).toBe(ELECTRICIAN_CHOICE_ISSUES.usual);
  expect(defaultElectricianChoice(addJobUsual(on))).toBe("usual");
  expect(fieldErrors([ELECTRICIAN_CHOICE_ISSUES.notOnboarded]).electrician).toBe(ELECTRICIAN_CHOICE_ISSUES.notOnboarded);
});
test("A3: onboarded = an approved REC match; Reinsulate (pays own electricians) needs no rate", () => {
  const rec = { business_id: "b1", name: "Sparkie Co", rec_number: "REC1", onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: null };
  const usual = { name: "Sparkie Co", licence: "REC1" };
  expect(usualIsOnboarded(usual as never, [rec] as never, null)).toBe(false);
  expect(usualIsOnboarded(usual as never, [rec] as never, 350)).toBe(true);
  expect(usualIsOnboarded(usual as never, [{ ...rec, piesa_rate: { id: "r", rate_inc_gst: 300 } }] as never, null)).toBe(true);
  expect(usualIsOnboarded(usual as never, [], null)).toBe(false);
  expect(usualIsOnboarded(null, [rec] as never, null)).toBe(false);
});
test("A3 wiring: server and options read the onboarded status", () => {
  expect(readFileSync("src/lib/onsite-ready-check.server.ts", "utf8")).toContain("addJobElectricianProblem(electricianChoice, status)");
  expect(readFileSync("src/lib/onsite-ready-check.functions.ts", "utf8")).toContain("readUsualElectricianStatus(data.businessId)");
});
