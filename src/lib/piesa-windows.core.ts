// Owner-picked PIESA windows (Operating Model v2). Pure rules only.
// Windows: morning 8am–12pm or afternoon 12pm–4pm, Melbourne time. Owner picks 3–5 windows on at least 3 different days.
// Allowed days (no capacity holds yet): business days from the 2nd business day after today, up to 21 days ahead.

export type PiesaSlot = "morning" | "afternoon";
export const PIESA_SLOTS: Record<PiesaSlot, { label: string; startHour: number; endHour: number }> = {
  morning: { label: "Morning (8am–12pm)", startHour: 8, endHour: 12 },
  afternoon: { label: "Afternoon (12pm–4pm)", startHour: 12, endHour: 16 },
};
export const PIESA_WINDOW_MIN = 3;
export const PIESA_WINDOW_MAX = 5;
export const PIESA_WINDOW_MIN_DAYS = 3;
export const PIESA_LEAD_BUSINESS_DAYS = 2;
export const PIESA_HORIZON_DAYS = 21;
export const PIESA_MAX_ROUNDS = 2;

const TZ = "Australia/Melbourne";
// Victorian public holidays (state-wide). Melbourne Cup Day included (metro Melbourne).
export const VIC_PUBLIC_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-26", "2026-03-09", "2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-25", "2026-06-08",
  "2026-09-25", "2026-11-03", "2026-12-25", "2026-12-26", "2026-12-28",
  "2027-01-01", "2027-01-26", "2027-03-08", "2027-03-26", "2027-03-27", "2027-03-28", "2027-03-29", "2027-04-25", "2027-04-26", "2027-06-14",
  "2027-11-02", "2027-12-25", "2027-12-26", "2027-12-27", "2027-12-28",
]);

export function melbourneYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekday(ymd: string): number { return new Date(`${ymd}T12:00:00Z`).getUTCDay(); }
export function isBusinessDay(ymd: string): boolean {
  const w = weekday(ymd);
  return w !== 0 && w !== 6 && !VIC_PUBLIC_HOLIDAYS.has(ymd);
}

/** UTC instant for hour:00 Melbourne local time on a date (handles daylight saving). */
export function melbourneAt(ymd: string, hour: number): Date {
  for (const off of [10, 11]) {
    const g = new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);
    g.setUTCHours(g.getUTCHours() - off);
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(g);
    if (melbourneYmd(g) === ymd && Number(local) === hour) return g;
  }
  const g = new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);
  g.setUTCHours(g.getUTCHours() - 10);
  return g;
}

export function windowBounds(ymd: string, slot: PiesaSlot): { starts_at: string; ends_at: string } {
  const s = PIESA_SLOTS[slot];
  return { starts_at: melbourneAt(ymd, s.startHour).toISOString(), ends_at: melbourneAt(ymd, s.endHour).toISOString() };
}

/** Days the owner may choose from. */
export function allowedPiesaDays(now: Date = new Date()): string[] {
  const today = melbourneYmd(now);
  let d = today, counted = 0;
  while (counted < PIESA_LEAD_BUSINESS_DAYS) { d = addDays(d, 1); if (isBusinessDay(d)) counted++; }
  const last = addDays(today, PIESA_HORIZON_DAYS);
  const out: string[] = [];
  for (let x = d; x <= last; x = addDays(x, 1)) if (isBusinessDay(x)) out.push(x);
  return out;
}

export type PiesaWindowPick = { date: string; slot: PiesaSlot };

export function piesaWindowBlockers(picks: PiesaWindowPick[], now: Date = new Date()): string[] {
  const out: string[] = [];
  const keys = new Set(picks.map((p) => `${p.date}:${p.slot}`));
  if (keys.size !== picks.length) out.push("Each time can only be chosen once.");
  if (picks.length < PIESA_WINDOW_MIN || picks.length > PIESA_WINDOW_MAX) out.push(`Please choose between ${PIESA_WINDOW_MIN} and ${PIESA_WINDOW_MAX} times.`);
  if (new Set(picks.map((p) => p.date)).size < PIESA_WINDOW_MIN_DAYS) out.push(`Please choose times on at least ${PIESA_WINDOW_MIN_DAYS} different days.`);
  const allowed = new Set(allowedPiesaDays(now));
  if (picks.some((p) => !allowed.has(p.date) || !(p.slot in PIESA_SLOTS))) out.push(`Times must be on a business day at least ${PIESA_LEAD_BUSINESS_DAYS} business days away and within the next ${PIESA_HORIZON_DAYS} days.`);
  return out;
}

/** What happens when every approved electrician has been tried for the owner's current round. */
export function noTakerStep(round: number): "ask_owner_for_more_times" | "needs_attention" | "none" {
  if (round <= 0) return "none";
  return round < PIESA_MAX_ROUNDS ? "ask_owner_for_more_times" : "needs_attention";
}

export function formatPiesaWindow(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(s);
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(s));
  const label = h < 12 ? "8am–12pm" : "12pm–4pm";
  void endsAt;
  return `${day}, ${label}`;
}

export const PIESA_NO_TAKER_DETAIL = "No electrician could take the owner's times (two rounds).";
