// Pure rules for the durable post-intake queue (initial Property Intelligence -> ONE official Gate 1 decision).
import { declaredExtras } from "./enquiry.core";

export const WORK_TYPE = "initial_gate1" as const;
export const LEASE_SECONDS = 180; // a worker holding an item longer than this is presumed dead
export const STALE_RUN_MS = 5 * 60_000; // property_intelligence_runs left 'running' longer than this are abandoned
export const MAX_ATTEMPTS = 6;
export const PROCESSING_NEXT_ACTION = "Initial eligibility checks processing";
export const ACTIVE = ["queued", "processing", "retry"] as const;

type O<T> = T | null | undefined;
type Input = {
  address_line?: O<string>; suburb?: O<string>; postcode?: O<string>; state?: O<string>; occupancy?: O<string>;
  estimated_area_m2?: O<number>; area_unknown?: O<boolean>; life_support?: O<boolean>; life_support_status?: O<string>;
  declared_property_type?: O<string>; declared_over_five_years?: O<string>; declared_previous_upgrade?: O<string>;
  property_research?: unknown; base44_answers?: unknown;
};
const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : v ?? null);

/** Only address + Step 1 fields Gate 1 reads. Consent, media, contact details are deliberately excluded. */
export function eligibilityFactsKey(i: Input): string {
  const ex = declaredExtras((i.base44_answers ?? null) as Record<string, unknown> | null);
  return JSON.stringify([
    norm(i.address_line), norm(i.suburb), norm(i.postcode), norm(i.state), norm(i.occupancy),
    i.area_unknown ? null : i.estimated_area_m2 ?? null, !!i.area_unknown, i.life_support_status ?? (i.life_support === true ? "yes" : null),
    norm(i.declared_property_type), norm(i.declared_over_five_years), "no" /* previous upgrade is always "no" (Jo 29 Oct 2026) */,
    norm(ex.existing_insulation), norm(ex.top_floor), i.property_research ?? null,
  ]);
}
export async function eligibilityFactsVersion(i: Input): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eligibilityFactsKey(i)));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export type WorkRow = { id: string; status: string; facts_version: string; attempts: number };
/** insert: no row yet; requeue: facts changed; none: unchanged (active or complete) -> no duplicate work. */
export function planEnqueue(existing: WorkRow | null, version: string): "insert" | "requeue" | "none" {
  if (!existing) return "insert";
  return existing.facts_version === version ? "none" : "requeue";
}

/** Exponential backoff for retryable failures: 1, 2, 4, 8, 16 min… capped at 60. */
export const retryDelayMs = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
export const afterFailure = (attempts: number) => (attempts >= MAX_ATTEMPTS ? ("failed" as const) : ("retry" as const));

/** A 'running' intelligence row is only trusted while fresh; older ones were abandoned (e.g. request aborted). */
export const isAbandonedRun = (r: { status: string; started_at: string }, now: number) => r.status === "running" && now - new Date(r.started_at).getTime() > STALE_RUN_MS;

/** Does the processor need a new intelligence run? Only missing / failed / abandoned / changed-address / stale evidence. */
export function intelligenceNeeded(last: { status: string; address_hash: string | null; is_stale: boolean; started_at: string } | null, currentHash: string, now: number, staleDays: number): string | null {
  if (!last) return "new enquiry";
  if (last.address_hash !== currentHash) return "address changed";
  if (last.is_stale) return "marked stale";
  if (last.status === "error") return "previous run failed";
  if (isAbandonedRun(last, now)) return "previous run abandoned";
  if (last.status === "running") return null; // a live run is in progress elsewhere; do not start a second
  if (now - new Date(last.started_at).getTime() > staleDays * 86400_000) return "data older than freshness window";
  return null;
}
