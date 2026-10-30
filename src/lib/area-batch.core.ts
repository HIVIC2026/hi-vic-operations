// Area batches (A48 batch 2). PURE: no I/O. Owner answers and the roof fact come in as plain values.
import { distanceM } from "./geo.core";
import { installerCanBeOffered, type WaitingInstaller } from "./installer-waiting-columns.core";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export type LikelyFacts = {
  propertyType: string | null;
  topFloor: string | null;
  overFiveYears: string | null;
  insulation: string | null;
  insulationThickness: string | null;
  roofForm: string | null;
};

/** Most likely eligible: house/townhouse (or top-floor unit), over 5 years, no insulation or "thin", roof not fully flat (unknown is fine). */
export function likelyEligible(f: LikelyFacts): boolean {
  const type = norm(f.propertyType);
  const homeOk = type === "house" || type === "townhouse" || (type === "apartment" && norm(f.topFloor) === "yes");
  if (!homeOk) return false;
  if (norm(f.overFiveYears) !== "yes") return false;
  if (norm(f.roofForm) === "low_slope_flat") return false;
  const ins = norm(f.insulation);
  return ins === "none" || (ins === "present" && norm(f.insulationThickness) === "thin");
}

export type BatchHome = { jobId: string; lat: number; lng: number; postcode: string; spotSavedAt: string };

const RADIUS_M = 10_000;
const MAX_BATCH = 10;
const MIN_BATCH = 8;
const SMALL_BATCH_WAIT_MS = 14 * 86_400_000;

/**
 * Densest-first greedy. Each home is tried as a centre; its batch is the nearest homes within 10 km of it
 * (centre included, capped at 10). A batch needs 8+ homes, or fewer only if every home has waited 14+ days.
 * The largest valid batch is taken, its homes are removed, repeat. A home is never in two batches.
 */
export function suggestBatches(homes: BatchHome[], nowIso: string): BatchHome[][] {
  const now = Date.parse(nowIso);
  const waitedEnough = (h: BatchHome) => now - Date.parse(h.spotSavedAt) >= SMALL_BATCH_WAIT_MS;
  const valid = (b: BatchHome[]) => b.length >= MIN_BATCH || (b.length > 0 && b.every(waitedEnough));
  let left = [...homes];
  const out: BatchHome[][] = [];
  for (;;) {
    let best: BatchHome[] | null = null;
    for (const c of left) {
      const batch = left
        .map((h) => ({ h, d: h === c ? 0 : distanceM(c, h) }))
        .filter((x) => x.d <= RADIUS_M)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_BATCH)
        .map((x) => x.h);
      if (valid(batch) && (!best || batch.length > best.length)) best = batch;
    }
    if (!best) return out;
    out.push(best);
    const taken = new Set(best);
    left = left.filter((h) => !taken.has(h));
  }
}

/** Garage, carport, car port or shed as a whole word, any case ("Shedding room" is not one). */
export const excludedAreaName = (name: string): boolean => /\b(garage|car\s?port|shed)\b/i.test(name);

// ---- Send (Task 2): events, keys, owner text, covering installers. PURE. ------------------------------------------------
/** One `area_batch_sent` per job (append-only workflow_events), written before the owner's text. */
export const AREA_BATCH_SENT_EVENT = "area_batch_sent";
/** Written per job when its batch closes (Task 4). A sent batch with no close for that job is still open. */
export const AREA_BATCH_CLOSED_EVENT = "area_batch_closed";
export const AREA_BATCH_EVENTS = [AREA_BATCH_SENT_EVENT, AREA_BATCH_CLOSED_EVENT] as const;

/** New owner texts: each has its own SMS switch, off until Jo switches it on. */
export const QUICK_TAPS_SMS_TYPE = "quick_taps" as const;
export const QUICK_TAPS_REMINDER_SMS_TYPE = "quick_taps_reminder" as const;

/** The owner's own My job link, on the quick taps screen. */
export const quickTapsLink = (myJobLink: string) => `${myJobLink}?screen=taps`;
const hiName = (fullName: string | null | undefined) => (fullName ?? "").trim().split(/\s+/)[0] || "there";
/** Jo approved 30 Oct 2026 (replaces the spec's first wording). Verbatim. No name → "Hi there," (Jo approved). */
export const quickTapsText = (fullName: string | null | undefined, link: string) =>
  `Hi ${hiName(fullName)}, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote: ${link} - Home Insulation Victoria`;
/** Day-2 reminder (sent by Task 4's sweep). Jo approved 30 Oct 2026. Verbatim. */
export const quickTapsReminderText = (fullName: string | null | undefined, link: string) =>
  `Hi ${hiName(fullName)}, just a reminder - please confirm a few quick details so we can book your free Ready Check: ${link}`;

/** Claim key of a job's n-th batch: the same job can never be claimed twice for the same slot. */
export const areaBatchKey = (jobId: string, seq: number) => `area-batch:v1:${jobId}:${seq}`;
export const quickTapsSmsKey = (batchId: string, jobId: string, step: "sent" | "reminder") => `quick-taps:v1:${batchId}:${jobId}:${step}`;

export type AreaBatchEventRow = { event_type: string; created_at: string; details: unknown };
const bid = (e: AreaBatchEventRow) => { const v = (e.details as { batch_id?: unknown } | null)?.batch_id; return typeof v === "string" && v ? v : null; };

/** The job's open batch (sent, not closed for this job), or null. One batch per job at a time. */
export function openBatchId(events: readonly AreaBatchEventRow[]): string | null {
  const closed = new Set(events.filter((e) => e.event_type === AREA_BATCH_CLOSED_EVENT).map(bid).filter(Boolean));
  const open = events.filter((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e) && !closed.has(bid(e)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return open.length ? bid(open[0]!) : null;
}
export const nextBatchSeq = (events: readonly AreaBatchEventRow[]) => events.filter((e) => e.event_type === AREA_BATCH_SENT_EVENT).length + 1;

/** Widest gap between two homes in the batch, in km (1 decimal). */
export function batchSpanKm(homes: readonly { lat: number; lng: number }[]): number {
  let m = 0;
  for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) m = Math.max(m, distanceM(homes[i]!, homes[j]!));
  return Math.round(m / 100) / 10;
}

export type BatchInstaller = WaitingInstaller & { covers_all_victoria?: boolean | null };
const VIC_POSTCODE = /^[38]\d{3}$/;
/** Installers who can be offered EVERY home: the Choose installer rule (`installerCanBeOffered`, verified postcode area),
 *  or an office-verified "anywhere in Victoria" area for a Victorian postcode. */
export function batchInstallers<I extends BatchInstaller>(installers: readonly I[], homes: readonly { postcode: string; isTest: boolean }[]): I[] {
  if (!homes.length) return [];
  return installers.filter((i) => homes.every((h) => {
    const pc = (h.postcode ?? "").trim();
    const all = i.covers_all_victoria === true && VIC_POSTCODE.test(pc);
    return installerCanBeOffered(all ? { ...i, service_postcodes: [pc] } : i, { postcode: pc || null, isTest: h.isTest });
  }));
}

/** The TEST office login never sees suggested batches (their functions are not on its allowlist); roles unknown → hidden. */
export const showAreaBatches = (roles: readonly string[] | null | undefined): boolean => !!roles && roles.includes("admin") && !roles.includes("qa_office");
