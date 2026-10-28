import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { JOBS_COLUMNS } from "../src/lib/jobs-columns.core";

// Jobs pages redesign, Task 3: the Our jobs / Installer jobs screen (table on computer, cards on phone).
const LANE = "src/components/portal/JobsLaneScreen.tsx";
const lane = () => readFileSync(LANE, "utf8");
const jobs = () => readFileSync("src/components/portal/JobsScreen.tsx", "utf8");

test("the screen exists and exports JobsLaneScreen({ lane, initialStage })", () => {
  expect(existsSync(LANE)).toBe(true);
  expect(lane()).toMatch(/export function JobsLaneScreen\(\{ lane, initialStage \}: \{ lane: JobsLane; initialStage\?: JobsStage/);
});

test("column headings come from JOBS_COLUMNS, in order, through ColumnHead", () => {
  expect(JOBS_COLUMNS({ nextSteps: [], installers: [] }).map((c) => c.label)).toEqual(
    ["Job", "Next step", "Owner", "Suburb", "Stage", "Days at stage", "m²", "Insulation", "Total cost", "Installer", "Last heard"]);
  const src = lane();
  expect(src).toContain("JOBS_COLUMNS({ nextSteps:");
  expect(src).toMatch(/cols\.map\(\(c\) => <ColumnHead /);
  expect(src).not.toContain("SortHead");
});

test("top of the page: search, Needs us, Actions, Filter; table on computer, cards on phone", () => {
  const src = lane();
  for (const s of ["Needs us", "Mitti sync problems", ">Filter<", "Clear filters", 'type="search"']) expect(src).toContain(s);
  expect(src).toContain("md:hidden");
  expect(src).toMatch(/"hidden [^"]*md:grid"/);
  expect(src).toContain("<Sheet ");
  expect(src).toContain("text-danger");
});

test("Mitti sync problems shows only above 0, in red, and never for the TEST office", () => {
  const src = lane();
  expect(src).toMatch(/!testOffice && syncCount > 0 && \(\s*<button [\s\S]{0,200}className="[^"]*text-danger[^"]*">\s*Mitti sync problems · \{syncCount\}/);
  expect(src).toContain("<MittiSyncProblems />");
  expect(src).toContain("enabled: !!me && !testOffice");
});

test("saved view: read and written only inside try/catch, per lane", () => {
  const src = lane();
  expect(src).toMatch(/try \{[^\n}]*parseSavedView\(localStorage\.getItem\(savedViewKey\(lane\)\)\)[^\n}]*\} catch/);
  expect(src).toMatch(/try \{[^\n}]*localStorage\.setItem\(savedViewKey\(lane\), JSON\.stringify\(view\)\)[^\n}]*\} catch/);
  const uses = src.split("\n").filter((l) => l.includes("localStorage"));
  expect(uses.length).toBe(2);
  for (const l of uses) expect(l).toMatch(/try \{.*\} catch/);
});

test("query key and refresh pattern", () => {
  const src = lane();
  expect(src).toContain('queryKey: ["office-jobs", lane, view, search, page]');
  expect(src).toContain("placeholderData: keepPreviousData");
  expect(src).toContain("refetchInterval: (x) => (x.state.data?.refreshing ? 5_000 : false)");
  expect(src).toContain('readOfficeList("jobs"');
});

test("Actions offers exactly Cancel · Put on hold · Mark as test · Delete (test jobs only), with the four reason dialogs", () => {
  const src = lane();
  const m = src.match(/<ActionsMenu [^\n]*actions=\{\[(.*?)\]\}/);
  expect(m).not.toBeNull();
  expect([...m![1]!.matchAll(/label: "([^"]+)"/g)].map((x) => x[1])).toEqual(["Cancel", "Put on hold", "Mark as test", "Delete (test jobs only)"]);
  for (const d of ['dialog === "cancel"', 'dialog === "hold"', 'dialog === "mark_test"', 'dialog === "delete"']) expect(src).toContain(d);
  expect(src).toContain("bulkCancelOfficeJobs");
  expect(src).toContain("bulkJobAction");
});

test("cells: Next step red when late, days as N d, m² or —, cost via costLabel", () => {
  const src = lane();
  expect(src).toContain('r.next.late && "text-danger"');
  expect(src).toContain("`${r.days} d`");
  expect(src).toContain("m²` : \"—\"");
  expect(src).toContain("costLabel(r.cost)");
});

test("JobsScreen: removed pieces are gone; Closed stays; switcher with lane counts", () => {
  const src = jobs();
  for (const gone of ["New from installers", "Ready Checks started in Mitti", "Installers’ own jobs", "Choose installer list", "FilterPanel", "ChipGroup", "function ActiveJobs", "function Piles", "function Tabs"]) expect(src).not.toContain(gone);
  expect(src).toContain("export function ClosedJobs");
  expect(src).toContain("export function JobsSwitcher({ current }: { current: \"ours\" | \"installer\" | \"closed\" })");
  for (const s of ["Our jobs", "Installer jobs", "Closed jobs", "getJobsLaneCounts"]) expect(src).toContain(s);
  expect(src).toContain('export function JobsScreen({ mode }: { mode: "closed" })');
});
