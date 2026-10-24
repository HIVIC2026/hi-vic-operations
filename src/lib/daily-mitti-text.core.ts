// Daily Mitti links text (Jo, 7 Oct). Pure: timing, eligibility and wording.
// Morning wording approved by Jo 24 Oct 2026 (decision 83): "Good morning! Your jobs today: 1) {time}, {short address}:
// {Mitti link} 2) … Tap a link to open its Mitti form." — exact arrival time (decision 43: no two-hour windows); when the
// list is too long for 3 segments it falls back to the My work link, as the decision allows. The sender adds the brand prefix.
import { melbourneYmd } from "./piesa-windows.core";

export const DAILY_TEXT_WORDING_VERSION = "APPROVED-2026-10-24-decision-83";
export const MAX_SMS_CHARS = 459; // 3 SMS segments; longer lists send the My work link instead.

/** Melbourne wall-clock HH:MM for an instant (handles daylight saving). */
export function melbourneHm(now: Date): string {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("hour")}:${g("minute")}`;
}
/** True once Melbourne time has reached the send time today. The tick runs every 15 min; send_key stops a repeat. */
export function dailySendDue(now: Date, sendTime: string): boolean {
  return /^\d{2}:\d{2}$/.test(sendTime) && melbourneHm(now) >= sendTime;
}
export function melbourneDate(now: Date): string { return melbourneYmd(now); }

function hm(iso: string): { h: number; m: number } {
  const [h, m] = melbourneHm(new Date(iso)).split(":").map(Number);
  return { h: h!, m: m! };
}
function fmt({ h, m }: { h: number; m: number }, withAmPm: boolean) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${withAmPm ? (h < 12 ? "am" : "pm") : ""}`;
}
/** "8am", "9:30am", "2pm" — the arrival time only (decision 43: exact arrival times, no window). */
export function arrivalTime(startIso: string): string { return fmt(hm(startIso), true); }
/** "8–10am", "11am–1pm", "2pm" (kept for the change-list text). */
export function timeWindow(startIso: string, endIso: string | null): string {
  const s = hm(startIso);
  if (!endIso) return fmt(s, true);
  const e = hm(endIso);
  const same = (s.h < 12) === (e.h < 12);
  return `${fmt(s, !same)}–${fmt(e, true)}`;
}
export function shortAddress(street: string | null, suburb: string | null): string {
  return [street?.trim(), suburb?.trim()].filter(Boolean).join(" ") || "Address on job page";
}

/** Which Mitti form a booking's link comes from. Install days link the installer's PIISA form (latest
 *  `mitti_piisa_audit_created` event), not the electrician's PIESA audit; electrician visits keep the PIESA audit. */
export type MittiFormSource = "ready_checks" | "assessments" | "piisa_event";
export function mittiFormSource(kind: string): MittiFormSource {
  if (kind === "ready_check") return "ready_checks";
  if (kind === "installation") return "piisa_event";
  return "assessments";
}

export type DayJob = { jobId: string; bookingId: string; start: string; end: string | null; street: string | null; suburb: string | null; link: string | null; status: string };
export type Trade = { businessId: string; approved: boolean; linked: boolean; mittiInvited: boolean; phone: string | null };

/** Why a trade gets no text (null = send). Shown to the office. */
export function skipReason(t: Trade): string | null {
  if (!t.approved) return "Trade not approved";
  if (!t.linked) return "Trade not linked to the job";
  if (!t.mittiInvited) return "Mitti account invited is not ticked";
  if (!t.phone) return "No mobile number on file";
  return null;
}

function line(j: DayJob, i: number) {
  return `${i + 1}) ${arrivalTime(j.start)}, ${shortAddress(j.street, j.suburb)}: ${j.link ?? "form not ready yet"}`;
}
/** Decision 83 morning text (the sender adds "Home Insulation Victoria: "). */
export function dailyText(jobs: DayJob[], myWorkLink: string): string {
  const live = [...jobs].filter((j) => j.status !== "cancelled").sort((a, b) => a.start.localeCompare(b.start));
  const full = `Good morning! Your jobs today: ${live.map(line).join(" ")} Tap a link to open its Mitti form.`;
  if (full.length <= MAX_SMS_CHARS) return full;
  // Fallback allowed by decision 83 ("falls back to the My work link when too long"); its sentence is not recorded verbatim.
  return `Good morning! You have ${live.length} jobs today. See them in time order with each Mitti form link: ${myWorkLink}`;
}

export type Snap = { bookingId: string; jobId: string; start: string; end: string | null; status: string };
export const snap = (j: DayJob): Snap => ({ bookingId: j.bookingId, jobId: j.jobId, start: j.start, end: j.end, status: j.status });

/** Changes since the last text: added, moved, cancelled. */
export function diffDay(prev: Snap[], now: DayJob[]) {
  const before = new Map(prev.filter((p) => p.status !== "cancelled").map((p) => [p.bookingId, p]));
  const changes: Array<{ kind: "added" | "moved" | "cancelled"; job: DayJob }> = [];
  for (const j of now) {
    const p = before.get(j.bookingId);
    if (j.status === "cancelled") { if (p) changes.push({ kind: "cancelled", job: j }); continue; }
    if (!p) changes.push({ kind: "added", job: j });
    else if (p.start !== j.start || p.end !== j.end) changes.push({ kind: "moved", job: j });
  }
  for (const p of before.values()) if (!now.some((j) => j.bookingId === p.bookingId)) changes.push({ kind: "cancelled", job: { ...p, street: null, suburb: null, link: null } });
  return changes;
}
export function updateText(changes: ReturnType<typeof diffDay>, myWorkLink: string): string {
  const parts = changes.map(({ kind, job }) => {
    const where = shortAddress(job.street, job.suburb);
    if (kind === "cancelled") return `Cancelled: ${where === "Address on job page" ? "a job" : where}`;
    return `${kind === "added" ? "Added" : "Moved"}: ${timeWindow(job.start, job.end)}, ${where}: ${job.link ?? "form not ready yet"}`;
  });
  const full = `HIV update for today – ${parts.join(". ")}.`;
  return full.length <= MAX_SMS_CHARS ? full : `HIV: Your jobs today have changed. See the latest list: ${myWorkLink}`;
}
