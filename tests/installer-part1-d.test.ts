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
