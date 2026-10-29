import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { couldntGetInDay } from "../src/lib/trade-view.core";
import { DAY_WHAT, dayNext } from "../src/lib/installer-screens.core";
import { FIXES_FORM_LINK_LABEL } from "../src/lib/fixes-day.core";
const src = (p: string) => readFileSync(p, "utf8");
const DAY = "src/routes/_authenticated/field.day.$jobId.tsx";

describe("D1/D2/D7 couldn't get in + load error", () => {
  test("the report is today's page, whatever booking is left", () => {
    expect(couldntGetInDay({ stage: "ready_check_ready_to_schedule", last: { visit: "ready_check", reason: "No one home" } })).toEqual({ visit: "ready_check", reason: "No one home" });
    expect(couldntGetInDay({ stage: "installation_scheduling", last: { visit: "install", reason: "Not safe to go up" } })).toEqual({ visit: "install", reason: "Not safe to go up" });
    expect(couldntGetInDay({ stage: "ready_check_scheduled", last: { visit: "ready_check", reason: "x" } })).toBeNull();
    expect(couldntGetInDay({ stage: "ready_check_ready_to_schedule", last: null })).toBeNull();
  });
  test("the installer stays assigned and the report is never treated as an old visit", () => {
    const srv = src("src/lib/trade-view.server.ts");
    const cgi = srv.slice(srv.indexOf("export async function tradeCouldntGetIn"), srv.indexOf("export async function confirmHivicReadyCheckPricing"));
    expect(cgi).not.toContain('from("job_assignments").update(');
    const day = srv.slice(srv.indexOf("export async function tradeDay"), srv.indexOf("export async function tradeCouldntGetIn"));
    expect(day).toContain("const cgiNow = couldntGetInDay(");
    expect(day).toContain("const historicalVisit = !cgiNow && ");
  });
  test("a refusal is shown in the sheet; a load error has a way back", () => {
    const page = src(DAY);
    expect(page).toContain("catch (e) { setCgiError(");
    expect(page).toContain("data-cgi-error");
    const err = page.slice(page.indexOf("if (error) return"), page.indexOf("if (!data) return"));
    expect(err).toContain("Back to My work");
  });
});
describe("D3 fixes visit", () => {
  test("fixes visit has its own words and form", () => {
    expect(DAY_WHAT.fixes).toBe("Electrical fixes");
    expect(FIXES_FORM_LINK_LABEL).toBe("Fixes form in Mitti");
    expect(dayNext({ kind: "fixes", channel: null, installFormComplete: false, rebateSigned: false })).toEqual({ title: "Do the fixes in Mitti", sub: "Open the fixes form. Press Complete when the repair work is done.", button: FIXES_FORM_LINK_LABEL, signRebate: false });
    const day = src("src/lib/trade-view.server.ts").slice(src("src/lib/trade-view.server.ts").indexOf("export async function tradeDay"));
    expect(day).toContain('b?.kind === "rectification" ? "fixes"');
    expect(day).toContain("fixesFormState(jobId)");
    expect(src(DAY)).toContain('const installer = data ? data.kind === "ready_check" || data.kind === "install" : false;');
    expect(src("src/lib/trade-view.core.ts")).not.toContain("export type DayKind =");
    expect(src("src/lib/installer-screens.core.ts").match(/export type DayKind =/g)?.length).toBe(1);
  });
});
describe("D3 fix round: install day reads the install form", () => {
  test("install day mittiId comes from installFormFacts, PIESA id only for the safety check", () => {
    const day = src("src/lib/trade-view.server.ts").slice(src("src/lib/trade-view.server.ts").indexOf("export async function tradeDay"));
    const end = day.indexOf("export async function tradeCouldntGetIn");
    const body = day.slice(0, end);
    expect(body).toContain('dayKind === "install" && c.biz.mitti_account_invited === true ? (await installFormFacts(jobId)).auditId');
    expect(body).toContain('dayKind === "install" ? installMittiId : a?.external_mitti_id');
  });
});

import { crewSelectionProblems } from "../src/lib/piisa-a3.core";
describe("D5 Lead + 2, Lead from the Team list", () => {
  const s = (id: string) => ({ workerId: id, name: id, eec: `CII-${id}`, eecVerified: true });
  const staff = ["a", "b", "c", "d"].map(s);
  test("Lead and 2 more, no more", () => {
    expect(crewSelectionProblems({ lead: "a", additional: [{ workerId: "b" }, { workerId: "c" }] }, staff).problems).toEqual([]);
    expect(crewSelectionProblems({ lead: "a", additional: [{ workerId: "b" }, { workerId: "c" }, { workerId: "d" }] }, staff).problems).toContain("The install form has room for a Lead and 2 more");
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("additional: z.array(pick).max(2)");
    expect(src("src/components/trade/PiisaCrewPicker.tsx")).toContain("extra.length < 2");
    expect(src("src/components/trade/PiisaCrewPicker.tsx")).not.toContain("extra.length < 3");
  });
  test("no typed-in Lead; crew members may still be entered", () => {
    expect(crewSelectionProblems({ lead: { other: { name: "Zed New", eec: "Z-1" } }, additional: [] }, staff).problems).toEqual(["Choose the Lead from your Team list"]);
    expect(crewSelectionProblems({ lead: null, additional: [] }, staff).problems).toEqual(["Choose the Lead from your Team list"]);
    expect(crewSelectionProblems({ lead: "a", additional: [{ other: { name: "Zed New", eec: "Z-1" } }] }, staff).needsVerification).toEqual(["Zed New (EEC Z-1) must be verified by the office before work starts"]);
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("lead: z.string().uuid().nullable()");
    const picker = src("src/components/trade/PiisaCrewPicker.tsx");
    expect(picker).not.toContain("data-lead-other");
    expect(picker).toContain("No CII-cleared installer is on your Team list yet. Add them under My business → Team.");
  });
});

import { leadNeedsHandover } from "../src/lib/visit-allocation.core";
import { CREW_TITLE } from "../src/lib/installer-screens.core";
import { BUNDLE_QUERY_KEYS } from "../src/lib/trade-job-bundle.core";
describe("D6 one crew picker", () => {
  test("the Lead gets the Mitti form; same person = no hand-over", () => {
    expect(leadNeedsHandover({ leadWorkerId: "a", allocatedWorkerId: null, assigneeWorkerId: "a" })).toBe(false);
    expect(leadNeedsHandover({ leadWorkerId: "b", allocatedWorkerId: null, assigneeWorkerId: "a" })).toBe(true);
    expect(leadNeedsHandover({ leadWorkerId: "b", allocatedWorkerId: "b", assigneeWorkerId: "a" })).toBe(false);
    expect(leadNeedsHandover({ leadWorkerId: null, allocatedWorkerId: "b", assigneeWorkerId: "a" })).toBe(false);
    expect(src("src/lib/piisa-a3.functions.ts")).toContain("saveCrewWithLead(data.jobId, context.userId, { lead: data.lead, additional: data.additional })");
    const srv = src("src/lib/visit-allocation.server.ts");
    const fn = srv.slice(srv.indexOf("export async function saveCrewWithLead"));
    expect(fn.indexOf("crewSelectionProblems(")).toBeLessThan(fn.indexOf("allocateVisit("));
    expect(fn).toContain("saveCrewSelection(jobId, userId, sel)");
  });
  test("one picker, one name, on the Job page and Today's job", () => {
    expect(CREW_TITLE).toBe("Who's on the crew today?");
    const picker = src("src/components/trade/PiisaCrewPicker.tsx");
    expect(picker).toContain("title={CREW_TITLE}");
    expect(picker).toContain(">Change</LinkRow>");
    expect(picker).toContain("staleTime: 20_000");
    expect(picker).not.toContain('"Crew today"');
    expect(src("src/routes/_authenticated/field.$jobId.tsx")).toContain('{visitsForStage(job.stage).includes("install") && <PiisaCrewPicker jobId={jobId} />}');
    expect(src(DAY)).toContain('{data.kind === "install" && <PiisaCrewPicker jobId={jobId} />}');
    const card = src("src/components/trade/visit-allocation.tsx");
    expect(card).toContain('data.visits.filter((v) => v.kind === "ready_check")');
    expect(card).not.toContain("Mitti install form");
  });
  test("the Job page still loads in one call", () => {
    expect(BUNDLE_QUERY_KEYS.crew("j")).toEqual(["piisa-crew", "j"]);
    expect(src("src/lib/trade-job-bundle.server.ts")).toContain('visitsForStage(ov.row.stage).includes("install")');
  });
});

describe("D8 remembered Start", () => {
  test("Start is remembered per job and visit time", () => {
    const tp = src("src/components/trade/TradePrestart.tsx");
    expect(tp).toContain("export function useRememberedStart(key: string): [boolean, () => void]");
    expect(tp.match(/try \{/g)?.length).toBeGreaterThanOrEqual(4);
    const page = src(DAY);
    expect(page).toContain("useRememberedStart(`hiv-started-${jobId}-${data?.start ?? \"\"}`)");
    expect(page).toContain("useRememberedStart(");
    expect(page).not.toContain("setStarted(true)");
  });
});
