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
  expect(src).toMatch(/try \{[^\n}]*localStorage\.setItem\(savedViewKey\(lane\), JSON\.stringify\(viewToSave\(view, once\)\)\)[^\n}]*\} catch/);
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

test("fix round 1: computer columns fit their headings and cells; phone Filter is a full-screen list with a Close", () => {
  const src = lane();
  const cols = src.match(/const COLS = "md:grid-cols-\[([^\]]+)\]"/)![1]!.split("_");
  expect(cols.length).toBe(12); // tick box + 11 columns
  const px = (i: number) => Number(cols[i]!.replace("px", ""));
  expect(px(8)).toBeGreaterThanOrEqual(80); // Insulation heading
  expect(px(9)).toBeGreaterThanOrEqual(96); // Total cost: heading and "$12,340 est."
  for (const c of cols) expect(c).toMatch(/^\d+px$|^minmax\(0,/); // nothing forces a sideways scroll
  expect(src).toContain('const CELL = "min-w-0 truncate"');
  expect(src).toContain("className={HEAD}");
  expect(src).toMatch(/<SheetContent side="bottom" className="inset-0 [^"]*h-\[100dvh\][^"]*overflow-y-auto/);
  expect(src).not.toContain("max-h-[90vh]");
  expect(src).toMatch(/<SheetClose asChild><button[^>]*>Close<\/button><\/SheetClose>/);
});

test("final fix 1: Installer jobs only — red 'Mitti forms to sort out · N' above 0, never for the TEST office, opens the link list", () => {
  const src = lane();
  expect(src).toContain('queryKey: ["mitti-pickups"], queryFn: () => pickupsFn()');
  expect(src).toContain('enabled: !!me && !testOffice && lane === "installer"');
  expect(src).toContain('const formsCount = lane === "installer" ? pickups.data?.rows.length ?? 0 : 0;');
  expect(src).toMatch(/!testOffice && formsCount > 0 && \(\s*<button [\s\S]{0,200}className="[^"]*text-danger[^"]*">\s*Mitti forms to sort out · \{formsCount\}/);
  expect(src).toContain("{!testOffice && formsOpen && formsCount > 0 && <div className=\"mb-3\"><MittiPickupsToLink /></div>}");
  // Needs me "Link form" and the old wording point to it.
  expect(readFileSync("src/routes/_authenticated/admin.needs-me.tsx", "utf8")).toContain('button: "Link form", href: "/admin/jobs/installers"');
  expect(readFileSync("src/lib/allocation.core.ts", "utf8")).toContain("open Installer jobs › Mitti forms to sort out");
  expect(readFileSync("src/routes/_authenticated/admin.settings.tsx", "utf8")).toContain("wait on Installer jobs › Mitti forms to sort out.");
  for (const f of ["src/lib/allocation.core.ts", "src/routes/_authenticated/admin.settings.tsx"]) expect(readFileSync(f, "utf8")).not.toContain("Ready Checks started in Mitti");
});

test("final fix 4: a small red 'Life support' tag next to the job number, in the table and on the phone card", () => {
  const src = lane();
  expect(src).toMatch(/const lifeSupport = r\.lifeSupport && <span className="[^"]*text-danger[^"]*">Life support<\/span>;/);
  expect(src).toContain("{job}{lifeSupport}{\" · \"}"); // phone card
  expect(src).toContain('<span className="min-w-0 break-words font-semibold">{job}{lifeSupport}</span>'); // computer Job cell
});

test("final fix 5: ?stage= from an old link shows once and is not written to the saved view", () => {
  const src = lane();
  expect(src).toContain("const o = openingView(saved, initialStage);");
  expect(src).toContain("setOnce(o.once);");
  expect(src).not.toMatch(/setView\(initialStage \?/);
});

test("final fix 6: the TEST office does not see the Closed jobs link", () => {
  const src = jobs();
  expect(src).toContain('const testOffice = me?.roles.includes("qa_office") ?? false;');
  expect(src).toContain('{!testOffice && <><span className="text-sub">·</span>{item("closed", "Closed jobs", undefined)}</>}');
});

test("final fix 7: partner business 'Open Jobs ›' goes to Installer jobs for installers; Choose installer links 'Our jobs ›'", () => {
  const biz = readFileSync("src/routes/_authenticated/admin.partners_.business.$businessId.tsx", "utf8");
  expect(biz).toContain('<Link to={b.kind === "Installer" ? "/admin/jobs/installers" : "/admin/jobs/ours"} search={{ q: b.name } as never}');
  const waiting = readFileSync("src/components/portal/InstallerWaitingScreen.tsx", "utf8");
  expect(waiting).toContain('<Link to="/admin/jobs/ours" className="font-semibold text-hiv-blue">Our jobs ›</Link>');
  expect(waiting).not.toContain("All active jobs");
});
