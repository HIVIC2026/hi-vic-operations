// Our-lead Ready Check: the office picks ONE installer, the installer offers the owner 3 times (Jo, 24 Oct 2026,
// decisions 49–53). Pure rules only. Mirrors install-days.core (installer offers 3 → owner takes one or suggests days →
// installer takes one at a time they choose, or offers 3 new ones), with no 30-day window: business days at least 24h
// ahead, up to READY_CHECK_HORIZON_DAYS out. The installer's own customers (installer_sourced) never use this.
import { formatInstallDay, installStartAt } from "./install-days.core";
import { isBusinessDay, melbourneYmd } from "./piesa-windows.core";
import { installerNoteSuffix } from "./installer-texts.core";

/** An office-picked Ready Check offer stays open this long (decision 51). */
export const READY_CHECK_OFFER_OPEN_HOURS = 24;
export const READY_CHECK_TIME_LEAD_HOURS = 24;
export const READY_CHECK_HORIZON_DAYS = 21;
export const READY_CHECK_INSTALLER_TIMES = 3;
export const READY_CHECK_OWNER_SUGGEST_MAX = 5;
/** appointment_proposals.note marker for these rows (kind ready_check) — no new table or column. */
export const READY_CHECK_TIME_NOTE = "ready_check_time";
/** partner_offers.summary flag: this offer is answered by offering the owner 3 times. */
export const READY_CHECK_TIMES_FLAG = "ready_check_times";

/** Arrival times the installer can pick (exact time, no window), 7am–5pm Melbourne. */
export const READY_CHECK_TIMES = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"] as const;
export type ReadyCheckTime = (typeof READY_CHECK_TIMES)[number];
export const isReadyCheckTime = (t: unknown): t is ReadyCheckTime => typeof t === "string" && (READY_CHECK_TIMES as readonly string[]).includes(t);

/** The Melbourne instant for a day + "HH:MM". */
export const readyCheckStartAt = (ymd: string, time: string): Date => installStartAt(ymd, time);
/** "Tuesday 27 October at 7:30am"; owner-suggested days show the day only. */
export const formatReadyCheckTime = (startIso: string, withTime = true) => formatInstallDay(startIso, withTime);

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days that can be offered or suggested: business days with at least one time 24h+ away, within the horizon. */
export function allowedReadyCheckDays(now: Date = new Date()): string[] {
  const out: string[] = [];
  const today = melbourneYmd(now);
  const lead = now.getTime() + READY_CHECK_TIME_LEAD_HOURS * 3_600_000;
  const last = READY_CHECK_TIMES[READY_CHECK_TIMES.length - 1]!;
  for (let i = 0; i <= READY_CHECK_HORIZON_DAYS; i++) {
    const d = addDays(today, i);
    if (!isBusinessDay(d)) continue;
    if (readyCheckStartAt(d, last).getTime() < lead) continue;
    out.push(d);
  }
  return out;
}

/** Times on a day that are still 24h+ away. */
export function allowedReadyCheckTimes(day: string, now: Date = new Date()): ReadyCheckTime[] {
  const lead = now.getTime() + READY_CHECK_TIME_LEAD_HOURS * 3_600_000;
  return READY_CHECK_TIMES.filter((t) => readyCheckStartAt(day, t).getTime() >= lead);
}

export type ReadyCheckPick = { day: string; time: string };

/** Installer's offer: exactly 3 times, each on a different allowed day, each at least 24h away. */
export function installerTimesBlockers(picks: ReadyCheckPick[], now: Date = new Date()): string[] {
  const b: string[] = [];
  const allowed = allowedReadyCheckDays(now);
  const days = new Set(picks.map((p) => p.day));
  if (picks.length !== READY_CHECK_INSTALLER_TIMES) b.push(`Please choose ${READY_CHECK_INSTALLER_TIMES} times.`);
  if (days.size !== picks.length) b.push("Please choose each time on a different day.");
  if (picks.some((p) => !isReadyCheckTime(p.time))) b.push("Please choose a time for each day.");
  if (picks.some((p) => !allowed.includes(p.day))) b.push("One of those days is no longer available. Please choose again.");
  else if (picks.some((p) => isReadyCheckTime(p.time) && !allowedReadyCheckTimes(p.day, now).includes(p.time))) b.push("Each time must be at least 24 hours away.");
  return b;
}

/** Owner: none of the installer's times suit → 1–5 days of their own (the installer then picks the time). */
export function ownerDaysBlockers(days: string[], now: Date = new Date()): string[] {
  const b: string[] = [];
  const allowed = allowedReadyCheckDays(now);
  const uniq = new Set(days);
  if (uniq.size !== days.length) b.push("Each day can only be chosen once.");
  if (uniq.size < 1) b.push("Please choose at least 1 day.");
  if (uniq.size > READY_CHECK_OWNER_SUGGEST_MAX) b.push(`Please choose no more than ${READY_CHECK_OWNER_SUGGEST_MAX} days.`);
  if ([...uniq].some((d) => !allowed.includes(d))) b.push("One of those days is no longer available. Please choose again.");
  return b;
}

export type ReadyCheckTimeRow = { id: string; proposer_role: string | null; status: string; starts_at: string };
export type ReadyCheckTurn = "no_installer" | "booked" | "installer_to_offer" | "owner_to_answer" | "installer_to_answer";

/** Whose move it is. Open = still proposed and not yet passed. */
export function readyCheckTurn(i: { booked: boolean; hasInstaller: boolean; rows: ReadyCheckTimeRow[]; now?: Date }): { turn: ReadyCheckTurn; open: ReadyCheckTimeRow[] } {
  const now = (i.now ?? new Date()).getTime();
  const open = i.rows.filter((r) => r.status === "proposed" && Date.parse(r.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (i.booked) return { turn: "booked", open: [] };
  if (!i.hasInstaller) return { turn: "no_installer", open: [] };
  const mine = open.filter((r) => r.proposer_role === "installer");
  if (mine.length) return { turn: "owner_to_answer", open: mine };
  if (open.length) return { turn: "installer_to_answer", open };
  return { turn: "installer_to_offer", open: [] };
}

/** Decision 80 (Jo 24 Oct 2026): a booked Ready Check on our leads can be changed by either side until it starts.
 *  Owner → back to the installer to offer 3 new times; installer → sets a new day + time directly. */
export function readyCheckChangeBlockers(f: { channel: string | null; stage: string | null; deleted: boolean; bookedAt: string | null }, now: Date = new Date()): string[] {
  if (f.deleted) return ["This job is no longer available."];
  if (f.channel !== "hivic_sourced") return ["Installers arrange the Ready Check directly with their own customers."];
  if (f.stage !== "ready_check_scheduled" || !f.bookedAt) return ["There is no booked Ready Check to change."];
  if (Date.parse(f.bookedAt) <= now.getTime()) return ["The Ready Check has already started."];
  return [];
}

/** Installer's new time: one allowed day + allowed time (same rules as offers: 7am–5pm, 24h+ away, within 21 days), not the booked one. */
export function installerRebookBlockers(pick: ReadyCheckPick, bookedAt: string | null, now: Date = new Date()): string[] {
  if (!isReadyCheckTime(pick.time)) return ["Please choose a time."];
  if (!allowedReadyCheckDays(now).includes(pick.day)) return ["That day is not available. Please choose again."];
  if (!allowedReadyCheckTimes(pick.day, now).includes(pick.time)) return ["The time must be at least 24 hours away."];
  if (bookedAt && readyCheckStartAt(pick.day, pick.time).getTime() === Date.parse(bookedAt)) return ["That is already the booked time."];
  return [];
}

/** Decision 110 (Jo 24 Oct): the installer's own customers (A1) — the installer arranges the visit himself and may
 *  enter the day and time on the job so the 6:30am text lists it. Only while the job waits for a Ready Check booking. */
export function a1ReadyCheckEntryAllowed(j: { channel: string | null; stage: string | null }): boolean {
  return j.channel === "installer_sourced" && j.stage === "ready_check_ready_to_schedule";
}
/** Same allowed-times rules as our-lead offers (exact times 7am–5pm, business days, 24h+ ahead, within 21 days). */
export function a1ReadyCheckTimeBlockers(pick: ReadyCheckPick, now: Date = new Date()): string[] {
  return installerRebookBlockers(pick, null, now);
}

/** When an office-picked offer closes by itself. */
export function readyCheckOfferExpiry(offeredAt: Date = new Date()): string {
  return new Date(offeredAt.getTime() + READY_CHECK_OFFER_OPEN_HOURS * 3_600_000).toISOString();
}

/** A pending offer past its 24 hours (by its own expiry, or by age for offers made before 24 Oct). */
export function readyCheckOfferOverdue(o: { offered_at: string; expires_at: string | null }, now: Date = new Date()): boolean {
  const t = now.getTime();
  return (!!o.expires_at && Date.parse(o.expires_at) <= t) || Date.parse(o.offered_at) + READY_CHECK_OFFER_OPEN_HOURS * 3_600_000 <= t;
}

/** Office pick: only our leads, waiting for a Ready Check, nobody assigned, nothing open, exactly one installer. */
export function readyCheckOfferStartBlockers(f: { channel: string | null; stage: string; deleted: boolean; hasInstaller: boolean; openOffers: number; picks: number }): string[] {
  const b: string[] = [];
  if (f.deleted) b.push("This job has been deleted.");
  if (f.channel !== "hivic_sourced") b.push("Installers arrange the Ready Check directly on their own customers' jobs.");
  if (f.stage !== "ready_check_ready_to_schedule") b.push("The job is not waiting for a Ready Check booking.");
  if (f.hasInstaller) b.push("An installer is already assigned.");
  if (f.openOffers > 0) b.push("A Ready Check offer is already open.");
  if (f.picks !== 1) b.push("Choose one installer.");
  return b;
}

export type OfficeOfferRow = { status: string; offered_at: string; business_name?: string | null };
export type ReadyCheckOfficeItem = { code: "choose_installer" } | { code: "offer_returned"; status: "declined" | "expired"; name: string | null } | null;

/** ONE office item per our-lead job waiting for a Ready Check: nothing sent yet → choose an installer;
 *  the latest offer came back (Not for me / 24h) → pick another. Nothing while an offer is open or someone is assigned. */
export function readyCheckOfficeItem(f: { channel: string | null; stage: string; hasInstaller: boolean; offers: OfficeOfferRow[] }): ReadyCheckOfficeItem {
  if (f.channel !== "hivic_sourced" || f.stage !== "ready_check_ready_to_schedule" || f.hasInstaller) return null;
  const sorted = [...f.offers].sort((a, b) => b.offered_at.localeCompare(a.offered_at));
  if (sorted.some((o) => o.status === "pending" || o.status === "accepted")) return null;
  const last = sorted[0];
  if (!last) return { code: "choose_installer" };
  if (last.status === "declined" || last.status === "expired") return { code: "offer_returned", status: last.status, name: last.business_name ?? null };
  return { code: "choose_installer" }; // withdrawn/superseded: nothing open, office chooses again
}

/** Job offer text to the installer — decision 76 wording, approved by Jo 24 Oct 2026 (switched on by decision 154).
 *  "(about {area} m²)" is left out when no area is known; nothing is invented. No STOP line: partner job texts don't carry one. */
export function readyCheckOfferText(suburb: string | null, url: string, areaM2: number | null = null, notes?: string[]): string {
  const area = typeof areaM2 === "number" && areaM2 > 0 ? ` (about ${Math.round(areaM2)} m²)` : "";
  // AI replies step 2: the latest office note about the job (never the owner's name or address).
  return `Home Insulation Victoria: New Ready Check job near ${suburb?.trim() || "you"}${area}. Offer the owner 3 times within 24 hours to take it: ${url}${installerNoteSuffix(notes)}`;
}
