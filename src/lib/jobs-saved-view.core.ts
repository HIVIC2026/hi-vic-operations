// Jobs pages: the saved view (filters, sort, needs-us) parsed from the browser's storage, and the once-only `?stage=`
// opening rule. PURE; type imports only, no runtime imports — read by the Jobs routes' loaders on every page's first
// download (portal speed step 2B). jobs-columns.core re-exports everything here unchanged.
import type { JobsColumnFilters, JobsLane, YesNo } from "./jobs-columns.core";
import type { Range } from "./enquiry-columns.core";
import type { JobsStage } from "./office-jobs-stage.core";
import type { LastHeardChip } from "./office-filters.core";

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

/** An old link's `?stage=` applies once (Jo, 28 Oct 2026): it filters this visit but is never written to the saved view. */
export type OnceStage = { stage: JobsStage; savedStage?: JobsStage[] };
export function openingView(saved: SavedView, initialStage: JobsStage | undefined): { view: SavedView; once: OnceStage | null } {
  if (!initialStage) return { view: saved, once: null };
  const once: OnceStage = saved.filters.stage ? { stage: initialStage, savedStage: saved.filters.stage } : { stage: initialStage };
  return { view: { ...saved, filters: { ...saved.filters, stage: [initialStage] } }, once };
}
/** What goes to the browser's saved view: the once-only stage swapped back for her own saved stage (if still showing). */
export function viewToSave(view: SavedView, once: OnceStage | null): SavedView {
  const st = view.filters.stage;
  if (!once || !st || st.length !== 1 || st[0] !== once.stage) return view;
  const { stage: _drop, ...rest } = view.filters;
  return { ...view, filters: once.savedStage ? { ...rest, stage: once.savedStage } : rest };
}
