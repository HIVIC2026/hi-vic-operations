import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LIST_SNAPSHOT_KEYS, isDefaultListView } from "../src/lib/office-needs-snapshot.core";
import { laneCounts, activeJobLane } from "../src/lib/jobs-columns.core";
import { QA_OFFICE_FUNCTIONS } from "../src/lib/qa-office-policy.core";

// Jobs pages redesign, Task 2: lane-aware list read.
const lists = readFileSync("src/lib/office-lists.server.ts", "utf8");
const fnStart = lists.indexOf("export async function loadActiveJobsList");
const jobsFn = lists.slice(fnStart);

test("the opening view of a lane is the default; Needs us is not", () => {
  const v = { lane: "ours", search: "", sort: "", page: 1, filters: {}, needsUs: false };
  expect(isDefaultListView(v)).toBe(true);
  expect(isDefaultListView({ ...v, lane: "installer" })).toBe(true);
  expect(isDefaultListView({ ...v, needsUs: true })).toBe(false);
});

test("each lane has its own saved copy; the old single key is gone", () => {
  expect(LIST_SNAPSHOT_KEYS.jobsOurs).toBe("jobs_ours:first");
  expect(LIST_SNAPSHOT_KEYS.jobsInstaller).toBe("jobs_installer:first");
  expect("jobs" in LIST_SNAPSHOT_KEYS).toBe(false);
});

test("loadActiveJobsList uses the lane helpers and no chip filters", () => {
  expect(fnStart).toBeGreaterThan(0);
  for (const name of ["channel", "laneOf(", "nextStep(", "daysAtStage(", "costCell(", "areaCell(", "insulationYesNo(", "matchesJobsFilters("]) expect(jobsFn).toContain(name);
  expect(jobsFn).not.toContain("matchesChips");
  for (const gone of ["stageCounts", "ownCount"]) expect(jobsFn).not.toContain(gone);
});

test("lane counts are a server function the TEST office may call", () => {
  const fns = readFileSync("src/lib/office-screens.functions.ts", "utf8");
  expect(fns).toContain("export const getJobsLaneCounts");
  expect(QA_OFFICE_FUNCTIONS["src/lib/office-screens.functions.ts"]).toContain("getJobsLaneCounts");
});

test("menu counts and the list share one rule: deleted, archived and stage-less jobs are not counted", () => {
  const j = { channel: "hivic_sourced", stage: "awaiting_quote_acceptance", priorStage: null, installerName: "A", originatingName: null, deleted: false };
  expect(activeJobLane(j)).toBe("ours");
  expect(activeJobLane({ ...j, channel: "installer_sourced" })).toBe("installer");
  expect(activeJobLane({ ...j, deleted: true })).toBeNull();
  expect(activeJobLane({ ...j, stage: "complete" })).toBeNull();
  expect(laneCounts([j, { ...j, channel: "installer_sourced" }, { ...j, deleted: true }, { ...j, stage: "cancelled" }])).toEqual({ ours: 1, installer: 1 });
  expect(jobsFn).toContain("activeJobInstaller(");
  expect(lists).toContain("laneCounts(");
});

test("final fix 2: release states are read once, for spot-saved rows only, and passed to nextStep (as Needs me)", () => {
  expect(jobsFn).toContain('["enquiry.spot_saved", "enquiry.spot_saved_video"].includes(v.status.key)');
  expect(jobsFn).toContain('.spotReleaseStates(spotSavedIds)');
  expect(jobsFn.match(/spotReleaseStates\(/g)?.length).toBe(1);
  expect(jobsFn).toContain("release: releases.get(id)?.state ?? null");
});
