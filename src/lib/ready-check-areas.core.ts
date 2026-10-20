// Ready Check ceiling areas (Jo-approved two-route brief, 20 Oct 2026). Pure rules only.
// Areas live on the CANONICAL Ready Check as one observation (`AREAS_FIELD_KEY`) on ready_check_observations; each area's
// original-condition / completion evidence is an ordinary evidence_requirements row tagged with `area_key`
// (pending migration 0214). No second job/evidence subsystem. Uploading a file never accepts it.

export const AREAS_FIELD_KEY = "areas.v1";
/** Per-area evidence rows sort after the job-level rows, so existing "first row for this category" lookups are unchanged. */
export const AREA_EVIDENCE_SORT = 800;
export const SUPPLIER = "Installer";
export const REVIEWER = "Home Insulation Victoria office";

export type Tri = "yes" | "no" | "unknown";
export type Existing = "none" | "present" | "unknown";
export type AreaSource = { kind: "installer_supplied" | "recorded_onsite"; by: string | null; at: string | null; note?: string | null };
export type RcArea = {
  key: string; label: string;
  areaM2: number | null; existing: Existing | null; rValue: number | null;
  removal: Tri | null; removalM2: number | null; product: string | null; scope: string | null;
  /** Who supplied each fact and when. Carried-forward facts keep their original supplier/time. */
  sources: Partial<Record<"areaM2" | "existing" | "removal" | "removalM2" | "product" | "scope", AreaSource>>;
};
export type AreaReq = { id: string; area_key: string | null; category: string; gate: string; status: string; label: string };

const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const num = (x: unknown) => (x == null || x === "" ? null : Number(x));

/** Structural + consistency problems. Partial drafts are fine: unknown/blank values never fail. */
export function areaProblems(areas: RcArea[], totalAreaM2: number | null = null): string[] {
  const p: string[] = []; const keys = new Set<string>(); const labels = new Set<string>();
  for (const a of areas) {
    const name = a.label.trim() || a.key;
    if (!KEY.test(a.key)) p.push(`${name}: invalid area reference`);
    if (keys.has(a.key)) p.push(`${name}: this area is listed twice`); keys.add(a.key);
    if (!a.label.trim()) p.push("Each ceiling area needs a name");
    else if (labels.has(a.label.trim().toLowerCase())) p.push(`${name}: two areas have the same name`); labels.add(a.label.trim().toLowerCase());
    for (const [k, v] of [["area", a.areaM2], ["removal area", a.removalM2], ["R-value", a.rValue]] as const)
      if (v != null && (!Number.isFinite(v) || v < 0)) p.push(`${name}: ${k} must be a number of zero or more`);
    if (a.removalM2 != null && a.areaM2 != null && a.removalM2 > a.areaM2) p.push(`${name}: removal area (${a.removalM2} m²) can't be more than the area (${a.areaM2} m²)`);
    if (a.removal === "no" && a.removalM2 != null && a.removalM2 > 0) p.push(`${name}: removal is "no" but a removal area is entered`);
    if (a.existing === "none" && a.removal === "yes") p.push(`${name}: no existing insulation, so nothing can be removed`);
  }
  if (totalAreaM2 != null && areas.length && areas.every((a) => a.areaM2 != null)) {
    const sum = Math.round(areas.reduce((s, a) => s + (a.areaM2 ?? 0), 0) * 100) / 100;
    if (Math.abs(sum - totalAreaM2) > 0.5) p.push(`The areas add up to ${sum} m², but the measured ceiling area is ${totalAreaM2} m² — correct one of them`);
  }
  return p;
}

export function totals(areas: RcArea[]) {
  const known = (f: (a: RcArea) => number | null) => (areas.length && areas.every((a) => f(a) != null) ? Math.round(areas.reduce((s, a) => s + (f(a) ?? 0), 0) * 100) / 100 : null);
  return { areaM2: known((a) => a.areaM2), removalM2: known((a) => (a.removal === "no" ? 0 : a.removalM2)) };
}

/**
 * Carry-forward for an ALREADY-ATTENDED installer: their saved facts become one suggested area, each fact labelled with
 * who supplied it and when. Not attended / unknown attendance: nothing — a preliminary estimate is never a site observation.
 */
export function carryForward(f: {
  attended: "yes" | "no" | null; areaM2: number | null; insulation: "none" | "below_r2" | "unknown" | null;
  removalRequired: boolean | null; removalM2: number | null; product: string | null; scope: string | null;
  suppliedBy: string | null; suppliedAt: string | null;
}): RcArea[] {
  if (f.attended !== "yes") return [];
  const src: AreaSource = { kind: "installer_supplied", by: f.suppliedBy, at: f.suppliedAt };
  const existing: Existing | null = f.insulation === "none" ? "none" : f.insulation === "below_r2" ? "present" : null; // "unknown" stays unknown
  const removal: Tri | null = f.removalRequired == null ? null : f.removalRequired ? "yes" : "no";
  const a: RcArea = { key: "main", label: "Main ceiling", areaM2: f.areaM2, existing, rValue: null, removal, removalM2: f.removalM2, product: f.product, scope: f.scope, sources: {} };
  for (const k of ["areaM2", "existing", "removal", "removalM2", "product", "scope"] as const) if (a[k] != null) a.sources[k] = src;
  return [a];
}

/** Evidence each area needs: original condition before removal/covering, completion after the work. */
export function areaEvidenceSpecs(a: RcArea) {
  return [
    { area_key: a.key, category: "before_ceiling_space", gate: "assessment", label: `${a.label} — original condition before any removal or covering` },
    { area_key: a.key, category: "completed_installation", gate: "installation", label: `${a.label} — completed installation` },
  ];
}

const statusText = (s: string) => (s === "rejected" ? "rejected — upload again" : s === "uploaded" ? "uploaded, waiting for office review" : "photo or video not uploaded");

/**
 * Server action-boundary hold: an area's removal, disturbance or covering may not start until its ORIGINAL-condition
 * answers are recorded and its before-work evidence has been ACCEPTED by the office. Missing, merely uploaded or
 * rejected evidence blocks. Each accepted requirement clears only itself.
 */
export function areaWorksBlockers(areas: RcArea[], reqs: AreaReq[]): string[] {
  const out: string[] = [];
  for (const a of areas) {
    if (a.existing == null || a.existing === "unknown") out.push(`${a.label}: existing insulation not recorded`);
    if (a.removal == null || a.removal === "unknown") out.push(`${a.label}: removal not recorded`);
    if (a.removal === "yes" && a.removalM2 == null) out.push(`${a.label}: removal area not recorded`);
    const before = reqs.find((r) => r.area_key === a.key && r.category === "before_ceiling_space");
    if (!before) out.push(`${a.label}: original-condition evidence item not set up — save the areas again`);
    else if (before.status !== "verified" && before.status !== "not_required") out.push(`${a.label}: original-condition evidence ${statusText(before.status)}`);
  }
  return out;
}

export type AreaTask = { area: string; item: string; status: string; suppliedBy: string; reviewedBy: string; due: string };
/** Missing-only, per area: what is outstanding, who supplies it and who reviews it. Accepted items are not listed. */
export function areaTasks(areas: RcArea[], reqs: AreaReq[]): AreaTask[] {
  const out: AreaTask[] = [];
  for (const a of areas) for (const r of reqs.filter((x) => x.area_key === a.key)) {
    if (r.status === "verified" || r.status === "not_required") continue;
    out.push({ area: a.label, item: r.label, status: statusText(r.status), suppliedBy: SUPPLIER, reviewedBy: REVIEWER,
      due: r.category === "before_ceiling_space" ? "before any removal or covering of this area" : "after the work, before office AP review" });
  }
  return out;
}

/** Parse a stored observation value fail-closed: anything malformed is reported, never treated as "no areas". */
export function readAreas(v: unknown): RcArea[] {
  if (v == null) return [];
  const list = (v as { areas?: unknown }).areas;
  if (!Array.isArray(list)) throw new Error("The saved ceiling areas could not be read.");
  return list.map((x) => {
    const a = x as { [K in keyof RcArea]?: unknown };
    if (typeof a.key !== "string" || typeof a.label !== "string") throw new Error("The saved ceiling areas could not be read.");
    return { key: a.key, label: a.label, areaM2: num(a.areaM2), existing: (a.existing ?? null) as Existing | null, rValue: num(a.rValue),
      removal: (a.removal ?? null) as Tri | null, removalM2: num(a.removalM2), product: (a.product as string | null) ?? null, scope: (a.scope as string | null) ?? null,
      sources: (a.sources ?? {}) as RcArea["sources"] };
  });
}

/** Server-side attribution (client-sent sources are ignored): an unchanged fact keeps its original supplier/time (from
 *  the saved areas, else the carry-forward suggestion); a new or changed fact is attributed to the person saving it now. */
export function attribute(prev: RcArea[], suggested: RcArea[], next: RcArea[], by: string, at: string): RcArea[] {
  return next.map((n) => {
    const o = prev.find((p) => p.key === n.key) ?? suggested.find((p) => p.key === n.key);
    const sources: RcArea["sources"] = {};
    for (const k of ["areaM2", "existing", "removal", "removalM2", "product", "scope"] as const) {
      if (n[k] == null) continue;
      sources[k] = o && o[k] === n[k] && o.sources[k] ? o.sources[k] : { kind: "recorded_onsite", by, at };
    }
    return { ...n, sources };
  });
}
