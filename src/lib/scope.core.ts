// PURE two-requirement model: (A) ceiling / insulation measure-up and (B) electrical assessment / PIESA.
// The ONE authoritative visit-scope derivation. Server code and UI both consume deriveScope's result.

export type VisitScope =
  | "COMBINED"
  | "ELECTRICAL_ONLY"
  | "MEASURE_UP_ONLY"
  | "ELECTRICAL_PLUS_MEASUREUP_COMPLETION"
  | "SPLIT"
  | "COMPLETE";

export const SCOPE_LABEL: Record<VisitScope, string> = {
  COMBINED: "Separate visits – installer Ready Check, electrician PIESA",
  ELECTRICAL_ONLY: "Electrical assessment only – Ready Check already accepted",
  MEASURE_UP_ONLY: "Ready Check only – PIESA already current",
  ELECTRICAL_PLUS_MEASUREUP_COMPLETION: "PIESA by electrician; installer must complete Ready Check evidence",
  SPLIT: "Electrical by electrician, Ready Check by installer",
  COMPLETE: "Requirements complete",
};

export const MEASURE_FIELDS = ["measured_area_m2", "insulation_present", "existing_r_value", "removal_required", "removal_m2", "access_difficulty"] as const;
export type MeasureField = (typeof MEASURE_FIELDS)[number];
export const MEASURE_FIELD_LABEL: Record<MeasureField, string> = {
  measured_area_m2: "measured ceiling area",
  insulation_present: "existing insulation present/absent",
  existing_r_value: "existing R-value",
  removal_required: "removal required",
  removal_m2: "removal m²",
  access_difficulty: "access difficulty",
};

export type MeasurementValues = {
  measured_area_m2?: number | null | undefined; insulation_present?: boolean | null | undefined; existing_r_value?: number | null | undefined;
  removal_required?: boolean | null | undefined; removal_m2?: number | null | undefined; access_difficulty?: "easy" | "moderate" | "difficult" | null | undefined;
};
/** Values as written to the database (no undefined keys). */
export type CleanMeasurementValues = Partial<{
  measured_area_m2: number | null; insulation_present: boolean | null; existing_r_value: number | null;
  removal_required: boolean | null; removal_m2: number | null; access_difficulty: "easy" | "moderate" | "difficult" | null;
}>;
export type MeasurementLike = MeasurementValues & {
  id?: string; status: "draft" | "needs_review" | "complete" | "rejected"; is_current?: boolean;
  source_role?: string; external_source?: string | null; external_id?: string | null; review_flags?: unknown;
};
export type ElectricalLike = { hasCurrentPiesa: boolean; piesaExpired: boolean };

/** Fields still missing for a complete measure-up (conditional fields only when relevant). */
export function missingMeasureFields(m: MeasurementValues | null | undefined): MeasureField[] {
  const out: MeasureField[] = [];
  if (!m || m.measured_area_m2 == null || !(Number(m.measured_area_m2) > 0)) out.push("measured_area_m2");
  if (m?.insulation_present == null) out.push("insulation_present");
  if (m?.insulation_present && m.existing_r_value == null) out.push("existing_r_value");
  if (m?.removal_required == null) out.push("removal_required");
  if (m?.removal_required && !(Number(m.removal_m2) > 0)) out.push("removal_m2");
  if (!m?.access_difficulty) out.push("access_difficulty");
  return out;
}

export function flaggedFields(m: MeasurementLike | null | undefined): MeasureField[] {
  const f = Array.isArray(m?.review_flags) ? (m!.review_flags as unknown[]) : [];
  return f.map((x) => (typeof x === "string" ? x : (x as { field?: string })?.field)).filter((x): x is MeasureField => (MEASURE_FIELDS as readonly string[]).includes(String(x)));
}

/** Missing + flagged fields, plus the conditional dependants of flagged yes/no answers. */
function completionFields(missing: MeasureField[], flagged: MeasureField[]): MeasureField[] {
  const set = new Set<MeasureField>([...missing, ...flagged]);
  if (set.has("insulation_present")) set.add("existing_r_value");
  if (set.has("removal_required")) set.add("removal_m2");
  return MEASURE_FIELDS.filter((f) => set.has(f));
}

export const measurementAccepted = (m: MeasurementLike | null | undefined) =>
  !!m && m.status === "complete" && Number(m.measured_area_m2) > 0;

export type ScopeResult = {
  scope: VisitScope;
  label: string;
  measurement: { state: "accepted" | "needs_review" | "draft" | "missing"; missing: MeasureField[]; flagged: MeasureField[] };
  electrical: { state: "current" | "expired" | "missing" };
  electricianTasks: ("electrical" | "measure_up" | "measure_up_completion")[];
  installerTasks: "measure_up"[];
  /** Fields the electrician may edit on this visit (never an accepted measurement). */
  editableMeasureFields: MeasureField[];
  nextAction: string | null;
};

export function deriveScope(input: { measurement: MeasurementLike | null; electrical: ElectricalLike; measureUpBy?: "electrician" | "installer" }): ScopeResult {
  const m = input.measurement && input.measurement.status !== "rejected" ? input.measurement : null;
  const accepted = measurementAccepted(m);
  const missing = accepted ? [] : missingMeasureFields(m);
  const flagged = accepted ? [] : flaggedFields(m);
  const partial = !!m && !accepted && (m.status === "needs_review" || MEASURE_FIELDS.some((k) => m[k] != null));
  const elecDone = input.electrical.hasCurrentPiesa && !input.electrical.piesaExpired;
  const electrical = { state: (elecDone ? "current" : input.electrical.hasCurrentPiesa ? "expired" : "missing") as ScopeResult["electrical"]["state"] };
  const measurement = { state: (accepted ? "accepted" : m?.status === "needs_review" ? "needs_review" : m ? "draft" : "missing") as ScopeResult["measurement"]["state"], missing, flagged };

  let scope: VisitScope;
  if (accepted && elecDone) scope = "COMPLETE";
  else if (accepted) scope = "ELECTRICAL_ONLY";
  else if (elecDone) scope = "MEASURE_UP_ONLY";
  else if (partial) scope = "ELECTRICAL_PLUS_MEASUREUP_COMPLETION";
  else scope = "SPLIT";

  const electricianTasks: ScopeResult["electricianTasks"] =
    scope === "ELECTRICAL_ONLY" || scope === "ELECTRICAL_PLUS_MEASUREUP_COMPLETION" || scope === "SPLIT" ? ["electrical"] : [];
  const installerTasks: ScopeResult["installerTasks"] = accepted ? [] : ["measure_up"];
  const editableMeasureFields: MeasureField[] = [];

  const need: string[] = [];
  if (!elecDone) need.push(electrical.state === "expired" ? "PIESA reassessment" : "electrical assessment / PIESA");
  if (!accepted) need.push(measurement.state === "needs_review" ? "installer Ready Check review / missing evidence" : "installer Ready Check");
  return { scope, label: SCOPE_LABEL[scope], measurement, electrical, electricianTasks, installerTasks, editableMeasureFields, nextAction: need.length ? `Still required: ${need.join(" and ")}` : null };
}

// ---------- Measurement update planning (manual entry, Mitti sync, imports) ----------
export type MeasurementPlan =
  | { action: "skip"; reason: string }
  | { action: "create"; values: CleanMeasurementValues; source: "electrician" | "installer" | "admin_import" }
  | { action: "update"; id: string; values: CleanMeasurementValues; supplemented: MeasureField[] };

/**
 * Decide how incoming measure-up values may touch the current measurement.
 * - accepted (complete) measurements are never overwritten
 * - ELECTRICAL_ONLY / COMPLETE never write measurement data
 * - ELECTRICAL_PLUS_MEASUREUP_COMPLETION only fills missing / flagged fields (provenance preserved)
 * - same external reference updates the same row (no duplicates on repeated sync)
 */
export function planMeasurementUpdate(p: {
  scope: VisitScope; current: MeasurementLike | null; incoming: MeasurementValues;
  source: "electrician" | "installer" | "admin_import"; external?: { source: string; id: string } | null;
}): MeasurementPlan {
  const vals = Object.fromEntries(MEASURE_FIELDS.filter((k) => p.incoming[k] !== undefined && p.incoming[k] !== null).map((k) => [k, p.incoming[k]])) as CleanMeasurementValues;
  const cur = p.current && p.current.status !== "rejected" ? p.current : null;
  if (!Object.keys(vals).length) return { action: "skip", reason: "No Ready Check values supplied." };
  if (cur && measurementAccepted(cur)) return { action: "skip", reason: "An accepted Ready Check already exists – it is not overwritten." };
  if (p.scope === "ELECTRICAL_ONLY" || p.scope === "COMPLETE") return { action: "skip", reason: "Electrical-only scope – Ready Check values ignored." };
  if (p.source === "electrician") return { action: "skip", reason: "Ready Check belongs to the installer; electricians record PIESA only." };
  if (!cur) return { action: "create", values: vals, source: p.source };
  if (p.scope === "ELECTRICAL_PLUS_MEASUREUP_COMPLETION" && cur.source_role !== p.source) {
    const allowed = new Set<MeasureField>(completionFields(missingMeasureFields(cur), flaggedFields(cur)));
    const filtered = Object.fromEntries(Object.entries(vals).filter(([k]) => allowed.has(k as MeasureField))) as CleanMeasurementValues;
    if (!Object.keys(filtered).length) return { action: "skip", reason: "No missing or flagged Ready Check fields to complete." };
    return { action: "update", id: cur.id!, values: filtered, supplemented: Object.keys(filtered) as MeasureField[] };
  }
  return { action: "update", id: cur.id!, values: vals, supplemented: [] };
}

/** Quote inputs come ONLY from the accepted/current ceiling measurement. */
export function quoteInputsFromMeasurement(m: MeasurementLike | null | undefined) {
  if (!m) throw new Error("Ready Check missing – quotes need an accepted Ready Check.");
  if (m.status !== "complete") throw new Error(`Ready Check is ${m.status.replace("_", " ")} – it must be accepted before quoting.`);
  if (!(Number(m.measured_area_m2) > 0)) throw new Error("Accepted Ready Check has no measured ceiling area.");
  return {
    areaM2: Number(m.measured_area_m2),
    removalM2: m.removal_required ? Number(m.removal_m2 ?? 0) : 0,
    access: (m.access_difficulty ?? "easy") as "easy" | "moderate" | "difficult",
    measurementId: m.id ?? null,
  };
}

/** Trade-safe projection of a measurement (no pricing or internal fields exist on it). */
export function tradeMeasurementView(m: MeasurementLike & Record<string, unknown>) {
  const { measured_area_m2, removal_required, removal_m2, insulation_present, existing_r_value, access_difficulty, status, source_role } = m;
  return { measured_area_m2, removal_required, removal_m2, insulation_present, existing_r_value, access_difficulty, status, source_role };
}
