import { expect, test } from "bun:test";
import {
  DEFAULT_VIEW, JOBS_COLUMNS, areaCell, costCell, costLabel, daysAtStage, insulationYesNo, laneOf, matchesJobsFilters,
  nextStep, openingView, parseSavedView, savedViewKey, viewToSave, type JobsColumnRow, type SavedView,
} from "../src/lib/jobs-columns.core";
import type { OfficeStatus } from "../src/lib/office-status.core";

const status = (o: Partial<OfficeStatus>): OfficeStatus => ({
  key: "quote.held", stage: "quote", label: "Quote held", waitingOn: "Us", since: "2026-10-01T00:00:00Z", dueAt: null,
  late: false, detail: null, action: null, ...o,
});
const off = { onHold: false, readyCheckBookingOn: true };

test("laneOf", () => {
  expect(laneOf("installer_sourced")).toBe("installer");
  expect(laneOf(null)).toBe("ours");
  expect(laneOf("website")).toBe("ours");
});

test("insulationYesNo", () => {
  expect(insulationYesNo("some")).toBe("yes");
  expect(insulationYesNo("not_sure")).toBe("yes");
  expect(insulationYesNo("no")).toBe("no");
});

test("nextStep: ours with action", () => {
  expect(nextStep(status({ action: "Send the quote", late: true }), off)).toEqual({ text: "Send the quote", ours: true, late: true });
});

test("nextStep: ours with no action uses the status label", () => {
  expect(nextStep(status({ action: null }), off)).toEqual({ text: "Quote held", ours: true, late: false });
});

test("nextStep: waiting on others", () => {
  expect(nextStep(status({ waitingOn: "Installer", late: true }), off)).toEqual({ text: "Waiting on installer", ours: false, late: true });
  expect(nextStep(status({ waitingOn: "Owner + Electrician" }), off).text).toBe("Waiting on owner and electrician");
  expect(nextStep(status({ waitingOn: "Owner + Installer" }), off).text).toBe("Waiting on owner and installer");
  expect(nextStep(status({ waitingOn: "Owner" }), off).text).toBe("Waiting on owner");
  expect(nextStep(status({ waitingOn: "Electrician" }), off).text).toBe("Waiting on electrician");
  expect(nextStep(status({ waitingOn: "System" }), off).text).toBe("Nothing yet");
  expect(nextStep(status({ waitingOn: "Nobody" }), off).text).toBe("Nothing yet");
  expect(nextStep(status({ waitingOn: "Office / campaign" }), off).text).toBe("Nothing yet");
});

test("nextStep: spot saved with booking off", () => {
  for (const key of ["enquiry.spot_saved", "enquiry.spot_saved_video"] as const) {
    const s = status({ key, stage: "enquiry", waitingOn: "Us", late: true, action: "Offer a time" });
    expect(nextStep(s, { onHold: false, readyCheckBookingOn: false })).toEqual({ text: "Nothing yet", ours: false, late: false });
    expect(nextStep(s, { onHold: false, readyCheckBookingOn: true })).toEqual({ text: "Offer a time", ours: true, late: true });
  }
});

test("nextStep: spot saved and released — pending waits on owner, lapsed keeps the action (matches Needs me)", () => {
  for (const key of ["enquiry.spot_saved", "enquiry.spot_saved_video"] as const) {
    const s = status({ key, stage: "enquiry", waitingOn: "Us", late: true, action: "Offer a time" });
    expect(nextStep(s, { ...off, release: "pending" })).toEqual({ text: "Waiting on owner", ours: false, late: false });
    expect(nextStep(s, { ...off, release: "lapsed" })).toEqual({ text: "Offer a time", ours: true, late: true });
    expect(nextStep(s, { ...off, release: "none" })).toEqual({ text: "Offer a time", ours: true, late: true });
    expect(nextStep(s, { ...off, release: null })).toEqual({ text: "Offer a time", ours: true, late: true });
    expect(nextStep(s, { onHold: false, readyCheckBookingOn: false, release: "pending" })).toEqual({ text: "Nothing yet", ours: false, late: false });
  }
  // Only spot-saved jobs read the release state.
  expect(nextStep(status({ action: "Send the quote" }), { ...off, release: "pending" })).toEqual({ text: "Send the quote", ours: true, late: false });
});

test("nextStep: on hold, and no status", () => {
  expect(nextStep(status({ late: true }), { onHold: true, readyCheckBookingOn: true })).toEqual({ text: "On hold", ours: false, late: true });
  expect(nextStep(null, off)).toEqual({ text: "Nothing yet", ours: false, late: false });
});

test("daysAtStage", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  expect(daysAtStage("2026-10-25T07:00:00Z", "2026-01-01T00:00:00Z", now)).toBe(3);
  expect(daysAtStage(null, "2026-10-20T12:00:00Z", now)).toBe(8);
  expect(daysAtStage("2026-11-05T00:00:00Z", "2026-01-01T00:00:00Z", now)).toBe(0);
});

test("costCell and costLabel", () => {
  expect(costCell({ lane: "ours", quoteTotal: 4200, estimateTotal: 3900 })).toEqual({ dollars: 4200, est: false });
  expect(costCell({ lane: "ours", quoteTotal: null, estimateTotal: 3900 })).toEqual({ dollars: 3900, est: true });
  expect(costCell({ lane: "installer", quoteTotal: null, estimateTotal: 3900 })).toEqual({ dollars: null, est: false });
  expect(costCell({ lane: "ours", quoteTotal: null, estimateTotal: null })).toEqual({ dollars: null, est: false });
  expect(costLabel({ dollars: 4200, est: false })).toBe("$4,200");
  expect(costLabel({ dollars: 3900, est: true })).toBe("$3,900 est.");
  expect(costLabel({ dollars: null, est: false })).toBe("—");
});

test("areaCell", () => {
  expect(areaCell(120, 95)).toBe(120);
  expect(areaCell(null, 95)).toBe(95);
  expect(areaCell(null, null)).toBeNull();
  expect(areaCell(0, 95)).toBe(95);
});

test("JOBS_COLUMNS", () => {
  const cols = JOBS_COLUMNS({ nextSteps: ["A", "B"], installers: ["Sam"] });
  expect(cols.map((c) => c.key)).toEqual(["job", "next", "owner", "suburb", "stage", "days", "area", "insulation", "cost", "installer", "heard"]);
  const by = Object.fromEntries(cols.map((c) => [c.key, c]));
  expect(by.stage).toMatchObject({ filter: "pick", options: ["choose_installer", "ready_check", "quote", "piesa", "install", "final_check"] });
  expect(by.next).toMatchObject({ filter: "pick", options: ["A", "B"] });
  expect(by.installer).toMatchObject({ filter: "pick", options: ["Sam"], labels: { Sam: "Sam" } });
  expect(by.insulation).toMatchObject({ labels: { yes: "Yes", no: "No" } });
  expect(by.days).toMatchObject({ filter: "range", unit: "days" });
  expect(by.area).toMatchObject({ filter: "range", unit: "m²" });
  expect(by.cost).toMatchObject({ filter: "range", unit: "$" });
  expect(by.job?.filter).toBe("text");
});

const row = (o: Partial<JobsColumnRow> = {}): JobsColumnRow => ({
  jobNumber: "HIV-1", owner: "Ann Lee", suburb: "Brunswick", next: { text: "Send the quote", ours: true, late: false }, stage: "quote",
  insulation: "yes", installer: "Sam", heard: "today", days: 2, areaM2: 80, cost: { dollars: 4000, est: false }, ...o,
});

test("matchesJobsFilters: ranges", () => {
  expect(matchesJobsFilters(row({ areaM2: null }), { area: { min: 50 } }, false)).toBe(false);
  expect(matchesJobsFilters(row({ areaM2: null }), {}, false)).toBe(true);
  expect(matchesJobsFilters(row(), { area: { min: 50 } }, false)).toBe(true);
  expect(matchesJobsFilters(row({ cost: { dollars: 4000, est: true } }), { cost: { min: 4500 } }, false)).toBe(false);
  expect(matchesJobsFilters(row({ days: 9 }), { days: { max: 5 } }, false)).toBe(false);
});

test("matchesJobsFilters: needsUs", () => {
  expect(matchesJobsFilters(row(), {}, true)).toBe(true);
  expect(matchesJobsFilters(row({ next: { text: "Waiting on owner", ours: false, late: false } }), {}, true)).toBe(false);
});

test("matchesJobsFilters: picks OR within, AND across", () => {
  expect(matchesJobsFilters(row(), { stage: ["quote", "install"] }, false)).toBe(true);
  expect(matchesJobsFilters(row(), { stage: ["quote"], insulation: ["yes"] }, false)).toBe(true);
  expect(matchesJobsFilters(row(), { stage: ["quote"], insulation: ["no"] }, false)).toBe(false);
  expect(matchesJobsFilters(row({ installer: null }), { installer: ["none"] }, false)).toBe(true);
  expect(matchesJobsFilters(row({ installer: null }), { installer: ["Sam"] }, false)).toBe(false);
  expect(matchesJobsFilters(row(), { next: ["Send the quote"], heard: ["week"] }, false)).toBe(false);
});

test("matchesJobsFilters: text", () => {
  expect(matchesJobsFilters(row(), { owner: "ann" }, false)).toBe(true);
  expect(matchesJobsFilters(row({ suburb: null }), { suburb: "brun" }, false)).toBe(false);
  expect(matchesJobsFilters(row(), { job: "hiv-1" }, false)).toBe(true);
});

test("parseSavedView", () => {
  expect(parseSavedView(null)).toEqual(DEFAULT_VIEW);
  expect(parseSavedView("not json")).toEqual(DEFAULT_VIEW);
  expect(parseSavedView('{"sort":5}')).toEqual(DEFAULT_VIEW);
  const v = { filters: { owner: "ann", stage: ["quote"], area: { min: 50 } }, sort: "days", dir: "asc", needsUs: true };
  expect(parseSavedView(JSON.stringify(v))).toEqual(v as never);
  expect(parseSavedView(JSON.stringify({ ...v, junk: 1, filters: { ...v.filters, bogus: 2 } }))).toEqual(v as never);
  expect(savedViewKey("ours")).toBe("hiv:jobs:ours");
  expect(savedViewKey("installer")).toBe("hiv:jobs:installer");
});

test("?stage= from an old link applies once: shown on that visit, never written to the saved view", () => {
  const saved: SavedView = { filters: { owner: "ann", stage: ["install"] }, sort: "days", dir: "asc", needsUs: true };
  const o = openingView(saved, "quote");
  expect(o.view).toEqual({ ...saved, filters: { owner: "ann", stage: ["quote"] } });
  expect(o.once).toEqual({ stage: "quote", savedStage: ["install"] });
  // Saving that visit keeps her own saved stage, and any other change she makes.
  expect(viewToSave(o.view, o.once)).toEqual(saved);
  expect(viewToSave({ ...o.view, needsUs: false }, o.once)).toEqual({ ...saved, needsUs: false });
  // If she picks a different stage herself on that visit, her own pick is saved.
  expect(viewToSave({ ...o.view, filters: { ...o.view.filters, stage: ["piesa"] } }, o.once).filters.stage).toEqual(["piesa"]);
  // No saved stage before: the once-only stage is simply left out.
  const plain = openingView(DEFAULT_VIEW, "final_check");
  expect(plain.view.filters).toEqual({ stage: ["final_check"] });
  expect(viewToSave(plain.view, plain.once)).toEqual(DEFAULT_VIEW);
  // No ?stage=: the saved view as it is, saved as it is.
  const none = openingView(saved, undefined);
  expect(none).toEqual({ view: saved, once: null });
  expect(viewToSave(saved, null)).toEqual(saved);
});
