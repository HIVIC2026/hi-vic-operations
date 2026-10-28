// Jobs pages ("Our jobs" / "Installer jobs"): pure column, filter and saved-view rules. No I/O.

import type { OfficeStatus, WaitingOn } from "./office-status.core";
import { LAST_HEARD_LABEL, type InsulationChip, type LastHeardChip } from "./office-filters.core";
import { inRange, textHit, type ListColumn, type Range } from "./enquiry-columns.core";
import { JOBS_STAGES, jobsStage, type JobsStage } from "./office-jobs.core";

export type JobsLane = "ours" | "installer";
export const laneOf = (channel: string | null): JobsLane => (channel === "installer_sourced" ? "installer" : "ours");

/** The installer shown for an active job: the assigned one, else (installer jobs) the business that sent it. */
export const activeJobInstaller = (channel: string | null, installerName: string | null, originatingName: string | null): string | null =>
  installerName ?? (channel === "installer_sourced" ? originatingName : null);

export type ActiveJobFacts = { channel: string | null; stage: string | null; priorStage: string | null; installerName: string | null; originatingName: string | null; deleted: boolean };
/** The one rule for "is this an active job on a Jobs page, and in which lane": the list's `all` and the menu counts both use it. */
export function activeJobLane(j: ActiveJobFacts): JobsLane | null {
  if (j.deleted) return null;
  const stage = jobsStage({ stage: j.stage, priorStage: j.priorStage, hasInstaller: !!activeJobInstaller(j.channel, j.installerName, j.originatingName) });
  return stage ? laneOf(j.channel) : null;
}
export function laneCounts(jobs: ActiveJobFacts[]): { ours: number; installer: number } {
  const c = { ours: 0, installer: 0 };
  for (const j of jobs) { const l = activeJobLane(j); if (l) c[l]++; }
  return c;
}

export type YesNo = "yes" | "no";
export const insulationYesNo = (c: InsulationChip): YesNo => (c === "no" ? "no" : "yes");

export type NextStep = { text: string; ours: boolean; late: boolean };
const NOTHING_YET = "Nothing yet";
const WAITING_TEXT: Record<WaitingOn, string> = {
  Us: NOTHING_YET,
  Owner: "Waiting on owner",
  Installer: "Waiting on installer",
  Electrician: "Waiting on electrician",
  "Owner + Installer": "Waiting on owner and installer",
  "Owner + Electrician": "Waiting on owner and electrician",
  System: NOTHING_YET,
  Nobody: NOTHING_YET,
  "Office / campaign": NOTHING_YET,
};
const SPOT_SAVED = new Set(["enquiry.spot_saved", "enquiry.spot_saved_video"]);

export function nextStep(s: OfficeStatus | null, o: { onHold: boolean; readyCheckBookingOn: boolean }): NextStep {
  if (o.onHold) return { text: "On hold", ours: false, late: s?.late ?? false };
  if (!s) return { text: NOTHING_YET, ours: false, late: false };
  if (s.waitingOn === "Us") {
    if (SPOT_SAVED.has(s.key) && !o.readyCheckBookingOn) return { text: NOTHING_YET, ours: false, late: false };
    return { text: s.action ?? s.label, ours: true, late: s.late };
  }
  return { text: WAITING_TEXT[s.waitingOn], ours: false, late: s.late };
}

export function daysAtStage(enteredStageAt: string | null, createdAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(enteredStageAt ?? createdAt)) / 86_400_000));
}

export type CostCell = { dollars: number | null; est: boolean };
export function costCell(o: { lane: JobsLane; quoteTotal: number | null; estimateTotal: number | null }): CostCell {
  if (o.quoteTotal != null) return { dollars: o.quoteTotal, est: false };
  if (o.lane === "ours" && o.estimateTotal != null) return { dollars: o.estimateTotal, est: true };
  return { dollars: null, est: false };
}
export const costLabel = (c: CostCell): string =>
  c.dollars == null ? "—" : `$${c.dollars.toLocaleString("en-AU")}${c.est ? " est." : ""}`;

export const areaCell = (measured: number | null, estimated: number | null): number | null =>
  measured != null && measured > 0 ? measured : estimated;

export function JOBS_COLUMNS(o: { nextSteps: string[]; installers: string[] }): ListColumn[] {
  const self = (xs: string[]) => Object.fromEntries(xs.map((x) => [x, x]));
  return [
    { key: "job", label: "Job", filter: "text" },
    { key: "next", label: "Next step", filter: "pick", options: o.nextSteps, labels: self(o.nextSteps) },
    { key: "owner", label: "Owner", filter: "text" },
    { key: "suburb", label: "Suburb", filter: "text" },
    { key: "stage", label: "Stage", filter: "pick", options: JOBS_STAGES.map((s) => s.key), labels: Object.fromEntries(JOBS_STAGES.map((s) => [s.key, s.label])) },
    { key: "days", label: "Days at stage", filter: "range", unit: "days" },
    { key: "area", label: "m²", filter: "range", unit: "m²" },
    { key: "insulation", label: "Insulation", filter: "pick", options: ["yes", "no"], labels: { yes: "Yes", no: "No" } },
    { key: "cost", label: "Total cost", filter: "range", unit: "$" },
    { key: "installer", label: "Installer", filter: "pick", options: o.installers, labels: self(o.installers) },
    { key: "heard", label: "Last heard", filter: "pick", options: Object.keys(LAST_HEARD_LABEL), labels: { ...LAST_HEARD_LABEL } },
  ];
}

export type JobsColumnFilters = {
  job?: string; owner?: string; suburb?: string; next?: string[]; stage?: JobsStage[]; insulation?: YesNo[];
  installer?: string[]; heard?: LastHeardChip[]; days?: Range; area?: Range; cost?: Range;
};
export type JobsColumnRow = {
  jobNumber: string; owner: string; suburb: string | null; next: NextStep; stage: JobsStage; insulation: YesNo;
  installer: string | null; heard: LastHeardChip; days: number; areaM2: number | null; cost: CostCell;
};

export function matchesJobsFilters(r: JobsColumnRow, f: JobsColumnFilters, needsUs: boolean): boolean {
  if (needsUs && !r.next.ours) return false;
  const pick = <T,>(sel: T[] | undefined, v: T) => !sel?.length || sel.includes(v);
  return textHit(r.jobNumber, f.job) && textHit(r.owner, f.owner) && textHit(r.suburb ?? "", f.suburb)
    && pick(f.next, r.next.text) && pick(f.stage, r.stage) && pick(f.insulation, r.insulation)
    && pick(f.installer, r.installer ?? "none") && pick(f.heard, r.heard)
    && inRange(r.days, f.days) && inRange(r.areaM2, f.area) && inRange(r.cost.dollars, f.cost);
}

export type SavedView = { filters: JobsColumnFilters; sort: string; dir: "asc" | "desc"; needsUs: boolean };
export const DEFAULT_VIEW: SavedView = { filters: {}, sort: "", dir: "desc", needsUs: false };
export const savedViewKey = (lane: JobsLane): string => "hiv:jobs:" + lane;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strArr = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);
const range = (v: unknown): Range | null => {
  if (!isObj(v)) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const r: Range = {};
  const min = num(v["min"]);
  const max = num(v["max"]);
  if (min != null) r.min = min;
  if (max != null) r.max = max;
  return r;
};

function parseFilters(v: unknown): JobsColumnFilters {
  if (!isObj(v)) return {};
  const f: JobsColumnFilters = {};
  for (const k of ["job", "owner", "suburb"] as const) if (typeof v[k] === "string") f[k] = v[k] as string;
  const next = strArr(v["next"]); if (next) f.next = next;
  const stage = strArr(v["stage"]); if (stage) f.stage = stage as JobsStage[];
  const ins = strArr(v["insulation"]); if (ins) f.insulation = ins as YesNo[];
  const inst = strArr(v["installer"]); if (inst) f.installer = inst;
  const heard = strArr(v["heard"]); if (heard) f.heard = heard as LastHeardChip[];
  for (const k of ["days", "area", "cost"] as const) { const r = range(v[k]); if (r) f[k] = r; }
  return f;
}

export function parseSavedView(raw: string | null): SavedView {
  if (!raw) return DEFAULT_VIEW;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return DEFAULT_VIEW; }
  if (!isObj(v)) return DEFAULT_VIEW;
  return {
    filters: parseFilters(v["filters"]),
    sort: typeof v["sort"] === "string" ? v["sort"] : DEFAULT_VIEW.sort,
    dir: v["dir"] === "asc" || v["dir"] === "desc" ? v["dir"] : DEFAULT_VIEW.dir,
    needsUs: typeof v["needsUs"] === "boolean" ? v["needsUs"] : DEFAULT_VIEW.needsUs,
  };
}
