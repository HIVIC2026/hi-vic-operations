// Saved spots by area (design 2026-11-03): everything we know about each saved spot, read in batches by job id, as the
// ranking core's SpotFacts plus where the home is. Read only. Used by the To release list (and later the listing queue).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insulationDetailFromDesk, type SpotFacts } from "./saved-spot-rank.core";
import { propertyPoint } from "./geo.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "./quick-taps.core";
import { declaredExtras, declaredInsulationDetail } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { hasFullStreet, postcodeCentre } from "./area-batch.server";

type Row = Record<string, unknown>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
const loose = admin as unknown as SupabaseClient;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) =>
  v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

export type SpotFactsWithPlace = SpotFacts & {
  lat: number | null;
  lng: number | null;
  address: string | null;
  listingUrl: string | null;
};

const FACT_KEYS = [
  "coordinates",
  "roof_form",
  "site_roof_risk",
  "building_ground_footprint",
  "solar_summary",
  "listing_check",
  "ai_photo_check",
] as const;

async function all(what: string, page: (from: number, to: number) => Res): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
/** Id lookups in chunks of 150, four in flight (AGENTS: one all-ids URL stalls). */
async function byIds(
  what: string,
  ids: string[],
  q: (chunk: string[], from: number, to: number) => Res,
): Promise<Row[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const out: Row[] = [];
  for (let i = 0; i < chunks.length; i += 4)
    out.push(
      ...(
        await Promise.all(chunks.slice(i, i + 4).map((c) => all(what, (f, t) => q(c, f, t))))
      ).flat(),
    );
  return out;
}

const PROPERTY_TYPE: Record<string, SpotFacts["propertyType"]> = {
  house: "house",
  townhouse: "townhouse",
  unit: "apartment",
  apartment: "apartment",
};
const ROOF_FORMS = new Set(["pitched", "low_slope_flat", "mixed"]);
const DESK = new Set([
  "looks_eligible",
  "not_eligible",
  "needs_onsite_check",
  "pending",
  "not_needed",
]);
const AI_VERDICTS = new Set(["none", "under_r2", "over_r2", "cant_tell"]);
const HATCH = new Set(["yes", "no", "not_sure"]);
const ROOF = new Set(["sloped", "flat", "some", "not_sure"]);
const pick = <T extends string>(v: unknown, allowed: Set<string>): T | null =>
  typeof v === "string" && allowed.has(v) ? (v as T) : null;
const yesNo = (v: unknown): "yes" | "no" | null => {
  if (v === true) return "yes";
  if (v === false) return "no";
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t === "yes" ? "yes" : t === "no" ? "no" : null;
};

/** The listing check (Task 7) → SpotFacts.listing; absent → null (not checked yet). */
function listingOf(v: unknown): {
  listing: SpotFacts["listing"];
  url: string | null;
  floorM2: number | null;
} {
  if (!v || typeof v !== "object") return { listing: null, url: null, floorM2: null };
  const l = v as Row;
  const found = l["status"] === "found";
  return {
    listing: {
      found,
      floorPlan: found && l["hasFloorPlan"] === true,
      type: found ? s(l["propertyType"]) : null,
      storeys: found ? n(l["storeys"]) : null,
      checked: true,
    },
    url: found ? s(l["url"]) : null,
    floorM2: found ? n(l["floorAreaM2"]) : null,
  };
}

/** The selects the reader needs. A caller that already reads these tables (the To release loader) selects at least
 *  these columns and hands the rows in, so nothing is read twice. */
export const SPOT_JOB_COLUMNS =
  "id, created_at, estimated_area_m2, life_support, property_id, properties(address_line, suburb, postcode, declared:enrichment->base44->declared, answers:enrichment->base44->raw->answers)";
export const SPOT_SAVED_COLUMNS =
  "job_id, spot_saved_at, saved_area_m2, saved_insulation, desk_check_status, desk_check_reason";

/** Rows the caller already loaded: jobs (SPOT_JOB_COLUMNS), saved spots (SPOT_SAVED_COLUMNS) and workflow events
 *  (any types; only quick-taps answers are used). Ids outside `jobIds` are ignored. */
export type SpotRows = { jobs: Row[]; saved: Row[]; events: Row[] };

/** Current property facts the ranking reads, for these properties (batched; a failed read throws). */
export async function readSpotPropertyFacts(propertyIds: string[]): Promise<Row[]> {
  const ids = [...new Set(propertyIds.filter(Boolean))];
  if (!ids.length) return [];
  return byIds("property facts", ids, (c, f, t) =>
    loose
      .from("property_facts")
      .select("property_id, fact_key, value")
      .in("property_id", c)
      .in("fact_key", [...FACT_KEYS])
      .eq("is_current", true)
      .range(f, t),
  );
}

/**
 * Facts for each job id (ids with no job row are left out). Location: the property's current `coordinates` fact, else
 * its postcode's centre; neither → lat/lng null ("Location not known"). `address` (and so the satellite link) only when
 * a street number is on file. `areaM2` is the saved / website size; callers with a measured size replace it.
 * `rows` / `facts`: rows the caller already has (see SpotRows, readSpotPropertyFacts) — then those tables aren't read.
 */
export async function readSpotFacts(
  jobIds: string[],
  opts: { now?: number; rows?: SpotRows; facts?: Row[] } = {},
): Promise<Map<string, SpotFactsWithPlace>> {
  const out = new Map<string, SpotFactsWithPlace>();
  const ids = [...new Set(jobIds)];
  if (!ids.length) return out;
  const want = new Set(ids);
  const [jobs, saved, taps] = opts.rows
    ? [
        opts.rows.jobs.filter((j) => want.has(String(j["id"]))),
        opts.rows.saved.filter((r) => want.has(String(r["job_id"]))),
        opts.rows.events.filter(
          (e) => e["event_type"] === QUICK_TAPS_ANSWERED_EVENT && want.has(String(e["job_id"])),
        ),
      ]
    : await Promise.all([
        byIds("saved spot homes", ids, (c, f, t) =>
          admin.from("jobs").select(SPOT_JOB_COLUMNS).in("id", c).range(f, t),
        ),
        byIds("saved spot answers", ids, (c, f, t) =>
          admin
            .from("lead_campaign_responses")
            .select(SPOT_SAVED_COLUMNS)
            .in("job_id", c)
            .range(f, t),
        ),
        byIds("quick taps answers", ids, (c, f, t) =>
          loose
            .from("workflow_events")
            .select("job_id, created_at, details")
            .in("job_id", c)
            .eq("event_type", QUICK_TAPS_ANSWERED_EVENT)
            .order("created_at")
            .order("id")
            .range(f, t),
        ),
      ]);
  const facts =
    opts.facts ??
    (await readSpotPropertyFacts(
      jobs.map((j) => s(j["property_id"])).filter((x): x is string => !!x),
    ));
  const savedBy = new Map(saved.map((r) => [String(r["job_id"]), r]));
  const tapsBy = new Map<string, Row>();
  for (const e of taps) {
    const k = String(e["job_id"]),
      prev = tapsBy.get(k);
    if (!prev || String(e["created_at"]) >= String(prev["created_at"])) tapsBy.set(k, e);
  }
  const factBy = new Map<string, unknown>();
  for (const f of facts) factBy.set(`${f["property_id"]}|${f["fact_key"]}`, f["value"]);

  for (const j of jobs) {
    const id = String(j["id"]);
    const pid = s(j["property_id"]);
    const fact = (k: (typeof FACT_KEYS)[number]) => (pid ? factBy.get(`${pid}|${k}`) : undefined);
    const prop = (j["properties"] ?? null) as {
      address_line?: string | null;
      suburb?: string | null;
      postcode?: string | null;
      declared?: Row | null;
      answers?: Row | null;
    } | null;
    const declared = prop?.declared ?? {},
      answers = prop?.answers ?? null;
    const sv = savedBy.get(id);
    const tap = ((tapsBy.get(id)?.["details"] as { answers?: Row } | null)?.answers ??
      null) as Row | null;
    const reason = s(sv?.["desk_check_reason"]);
    const extras = declaredExtras(answers);
    const typeText = (s(declared["property_type"]) ?? s(answers?.["property_type"]) ?? "")
      .trim()
      .toLowerCase();
    const listing = listingOf(fact("listing_check"));
    const risk = fact("site_roof_risk") as { flags?: unknown } | null | undefined;
    const ai = fact("ai_photo_check") as { verdict?: unknown } | null | undefined;

    const postcode = (prop?.postcode ?? "").trim();
    const streetKnown = hasFullStreet(prop?.address_line);
    const point = propertyPoint(fact("coordinates")) ?? (await postcodeCentre(postcode));
    const address = streetKnown
      ? `${String(prop?.address_line).trim()}, ${[(prop?.suburb ?? "").trim(), "VIC", postcode].filter(Boolean).join(" ")}`
      : null;
    const savedArea = n(sv?.["saved_area_m2"]) ?? n(j["estimated_area_m2"]);
    // Size from above (Google Solar): only ever feeds the estimated ceiling, never the owner's figure.
    const roofGround = n(
      (fact("solar_summary") as { roof_ground_area_m2?: unknown } | null | undefined)
        ?.roof_ground_area_m2,
    );
    const foot = n((fact("building_ground_footprint") as { m2?: unknown } | null | undefined)?.m2);

    out.set(id, {
      insulation: normaliseInsulation(s(sv?.["saved_insulation"]) ?? extras.existing_insulation),
      insulationDetail:
        insulationDetailFromDesk(reason) ??
        (declaredInsulationDetail(answers).insulation_thickness === "thin" ? "thin" : null),
      deskCheck: pick(sv?.["desk_check_status"], DESK),
      aiPhoto: pick(ai?.verdict, AI_VERDICTS),
      propertyType: PROPERTY_TYPE[typeText] ?? null,
      topFloor: yesNo(declared["top_floor"]) ?? yesNo(extras.top_floor),
      areaM2: savedArea != null && savedArea > 0 ? savedArea : null,
      roofForm: pick(fact("roof_form"), ROOF_FORMS),
      // Only Solar's "complex roof (N segments)" flag: flat / mixed roofs already score through roofForm.
      complexRoof:
        Array.isArray(risk?.flags) &&
        risk.flags.some((x) => typeof x === "string" && x.startsWith("complex roof")),
      tapsHatch: pick(tap?.["hatch"], HATCH),
      tapsRoof: pick(tap?.["roof"], ROOF),
      listing: listing.listing,
      lifeSupport: j["life_support"] === true,
      streetKnown,
      spotSavedAt: s(sv?.["spot_saved_at"]) ?? String(j["created_at"] ?? ""),
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      address,
      listingUrl: listing.url,
      footprintM2: foot != null && foot > 0 ? Math.round(foot) : null,
      roofGroundM2: roofGround != null && roofGround > 0 ? Math.round(roofGround) : null,
      listingFloorM2: listing.floorM2 != null && listing.floorM2 > 0 ? listing.floorM2 : null,
    });
  }
  return out;
}
