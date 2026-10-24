// Installer "My work" (approved mock-up M1, decision 198; decisions 36, 41, 43, 48). PURE presentation only: it
// puts each of the installer's jobs in exactly ONE of Action needed / In progress / Done and writes ONE "Next:" line
// per job from facts the server has already decided (place, stage, quote status, Mitti basics, bookings).
// It never moves a job, never decides workflow, eligibility, allocation or pay, and never carries an owner price.
import { PRESS_COMPLETE_LINE, QUOTE_ACCEPTED_LINE, QUOTE_DECLINED_LINE, QUOTE_HELD_LINE, QUOTE_SENT_LINE } from "./installer-quote-status.core";

export type HomeGroup = "action" | "progress" | "done" | "offer";
export type InstallerHomeJob = {
  jobId: string;
  jobNumber: string | number | null;
  /** "5 Somerset Court, Mulgrave" (street + suburb, no postcode). */
  street: string | null;
  suburb: string | null;
  channel: string | null;
  stage: string;
  /** Where the existing placement put the job (work-places.core). */
  place: "offers" | "needs_me" | "coming_up" | "moving";
  /** The placement's own title (e.g. "Book the install with the owner", "2 photos missing"). */
  placeTitle: string | null;
  /** jobs.next_action — "Needs finishing: price, owner mobile… on the Mitti form" means the Mitti basics are missing. */
  nextAction: string | null;
  /** installerQuoteLine(...) for a Ready Check quote on the job, else null. */
  quoteLine: string | null;
  /** The shared status line (job-status.core) as the viewer sees it. */
  status: { text: string; who: string | null } | null;
  /** This installer's next confirmed visit on the job. */
  upcoming: { what: string; start: string } | null;
  /** 30-day install deadline (job_piesa_deadlines.install_deadline), when known. */
  installDeadline: string | null;
  /** When the job reached its final stage (Done rows). */
  endedAt: string | null;
};
export type InstallerHomeRow = InstallerHomeJob & { group: HomeGroup; next: string };

const TZ = "Australia/Melbourne";
const fmtDayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: TZ });
const fmtWeekdayDayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).replace(",", "");
/** "7:30am", "8:00am", "12:00pm" — exact arrival time, never a window (decision 43). */
export function exactTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).replace(/\s/g, "").toLowerCase();
}

/** Decision 48: a quiet grey source label, never the installer's own business name repeated back. */
export function sourceLabel(channel: string | null | undefined): string | null {
  if (channel === "installer_sourced") return "Your customer";
  if (channel === "hivic_sourced") return "Home Insulation Victoria lead";
  return null;
}

/** "Needs finishing: price, owner mobile/email/permission on the Mitti form" → "price and owner details". */
export function needsFinishingItems(nextAction: string | null | undefined): string | null {
  const m = /^Needs finishing:\s*(.+?)\s*(on the Mitti form)?\.?$/i.exec(nextAction ?? "");
  if (!m?.[1]) return null;
  const items = m[1].replace(/^add\s+/i, "").split(/,\s*/).map((p) => p.trim()).filter(Boolean).map((p) =>
    /^price$/i.test(p) ? "price" : /^owner\s+/i.test(p) ? "owner details" : p.toLowerCase());
  const uniq = [...new Set(items)];
  if (!uniq.length) return null;
  return uniq.length > 1 ? `${uniq.slice(0, -1).join(", ")} and ${uniq[uniq.length - 1]}` : uniq[0]!;
}

const ELECTRICIAN_STAGES = new Set(["piesa_and_install_window_pending", "awaiting_electrician", "assessment_booking", "piesa_scheduled", "assessment_booked", "piesa_complete", "assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "electrical_variation_pending", "rectification_scheduling", "rectification_booked"]);

/** ONE "Next:" line and the group it belongs to. Order of precedence is the installer's own task first. */
export function installerNext(j: InstallerHomeJob): { group: HomeGroup; next: string } {
  if (j.stage === "complete" || j.stage === "cancelled") return { group: "done", next: doneLine(j.stage, j.endedAt) };
  if (j.place === "offers") return { group: "offer", next: "Next: reply to the job offer" };
  const missing = needsFinishingItems(j.nextAction);
  if (missing) return { group: "action", next: `Next: finish the Mitti form (${missing} missing)` };
  if (j.quoteLine === PRESS_COMPLETE_LINE) return { group: "action", next: "Next: press Complete in Mitti when the Ready Check is finished" };
  if (j.quoteLine === QUOTE_HELD_LINE) return { group: "progress", next: "Next: nothing yet — office is checking the quote" };
  if (j.quoteLine === QUOTE_SENT_LINE) return { group: "progress", next: "Next: nothing yet — owner has the quote" };
  if (j.quoteLine === QUOTE_DECLINED_LINE) return { group: "progress", next: "Next: nothing yet — owner declined the quote" };
  if (j.place === "coming_up" && j.upcoming) return { group: "progress", next: `Next: ${j.upcoming.what.toLowerCase() === "install" ? "install" : j.upcoming.what} ${fmtWeekdayDayMonth(j.upcoming.start)} at ${exactTime(j.upcoming.start)}` };
  if (j.place === "needs_me") {
    const t = j.placeTitle ?? "";
    if (/suggested time/i.test(t)) return { group: "action", next: "Next: reply to the owner's suggested time" };
    if (/book the ready check/i.test(t)) return { group: "action", next: j.channel === "installer_sourced" ? "Next: enter the Ready Check day" : "Next: offer the owner 3 Ready Check times" };
    if (/do the ready check/i.test(t)) return { group: "action", next: "Next: do the Ready Check and fill in the Mitti form" };
    if (/book the install/i.test(t)) return { group: "action", next: `Next: offer 3 install days${j.installDeadline ? ` by ${fmtDayMonth(j.installDeadline)}` : ""}` };
    if (/install and add the photos/i.test(t)) return { group: "action", next: "Next: install and press Complete in Mitti" };
    const photos = /^(\d+) photos? missing$/i.exec(t);
    if (photos) return { group: "action", next: `Next: add the ${photos[1]} missing install photo${photos[1] === "1" ? "" : "s"} in Mitti` };
    if (/missing install photos/i.test(t)) return { group: "action", next: "Next: add the missing install photos in Mitti" };
    return { group: "action", next: `Next: ${t ? t.charAt(0).toLowerCase() + t.slice(1) : "open the job"}` };
  }
  // Nothing for the installer right now: say plainly whose move it is.
  const quiet = (why: string) => ({ group: "progress" as const, next: `Next: nothing yet — ${why}` });
  if (j.stage === "on_hold") return quiet("on hold while the office reviews it");
  if (j.stage === "ready_check_ready_to_schedule") return j.status?.who === "Owner" ? quiet("owner is choosing a Ready Check time") : quiet("office is arranging the Ready Check time");
  if (j.stage === "ready_check_scheduled") return quiet("Ready Check booked");
  if (j.stage === "ready_check_complete") return quiet("office is checking your Ready Check");
  if (j.stage === "measured_estimate_ready" || j.stage === "awaiting_quote_acceptance" || j.stage === "ready_check_awaiting_acceptance" || j.stage === "preliminary_estimate_ready") return quiet("owner has the quote");
  if (j.stage === "measured_quote_accepted" || j.stage === "awaiting_deposit_payment" || j.quoteLine === QUOTE_ACCEPTED_LINE) return quiet("owner's safety check comes first");
  if (ELECTRICIAN_STAGES.has(j.stage) || /waiting for the electrician/i.test(j.placeTitle ?? "")) return quiet("electrician's safety check first");
  if (j.stage === "evidence_outstanding" || j.stage === "ap_review") return quiet("office is checking the install photos");
  if (j.stage === "ready_for_veec") {
    const s = j.status?.text ?? "";
    if (/^Paid to you/i.test(s)) return { group: "progress", next: `Next: nothing — ${s.charAt(0).toLowerCase()}${s.slice(1)}` };
    if (/^Payment coming/i.test(s)) return quiet(`${s.charAt(0).toLowerCase()}${s.slice(1)}`);
    return quiet("office is checking the install photos");
  }
  return quiet("office is working on it");
}

/** Done row: "Job complete 16 Oct" / "Cancelled 16 Oct" (date only when the final stage date is known). */
export function doneLine(stage: string, endedAt: string | null): string {
  const what = stage === "cancelled" ? "Cancelled" : stage === "complete" ? "Job complete" : "Closed";
  return endedAt ? `${what} ${fmtDayMonth(endedAt)}` : what;
}

/** Done row: "Your customer · Job complete 16 Oct" (source first, quiet grey). */
export function doneSub(channel: string | null | undefined, stage: string, endedAt: string | null): string {
  return [sourceLabel(channel), doneLine(stage, endedAt)].filter(Boolean).join(" · ");
}

/** Three groups, every job in exactly one; offers are shown in the offer panel, not in a group. */
export function installerHomeGroups(jobs: InstallerHomeJob[]): { action: InstallerHomeRow[]; progress: InstallerHomeRow[]; done: InstallerHomeRow[] } {
  const rows = jobs.map((j) => ({ ...j, ...installerNext(j) }));
  return { action: rows.filter((r) => r.group === "action"), progress: rows.filter((r) => r.group === "progress"), done: rows.filter((r) => r.group === "done") };
}

/** Section heading count: "Action needed · 3". */
export const GROUP_LABEL: Record<Exclude<HomeGroup, "offer">, string> = { action: "Action needed", progress: "In progress", done: "Done" };

/** Offer panel words: "1 new job offer" · "Ready Check in Glen Waverley" · "About 120 m² · Home Insulation Victoria lead". */
export function offerPanelWords(o: { suburb: string | null; areaM2: number | null }, count: number): { eyebrow: string; title: string; detail: string } {
  return {
    eyebrow: `${count} new job offer${count === 1 ? "" : "s"}`,
    title: `Ready Check in ${o.suburb ?? "Victoria"}`,
    detail: [o.areaM2 ? `About ${Math.round(o.areaM2)} m²` : null, "Home Insulation Victoria lead"].filter(Boolean).join(" · "),
  };
}

/** This month strip (business owner only, own pay only): "4 installs done" · "$6,840 paid". */
export function monthStripWords(m: { jobs: number; paid: number }): { installs: string; paid: string } {
  return { installs: `${m.jobs} install${m.jobs === 1 ? "" : "s"} done`, paid: `$${Math.floor(m.paid).toLocaleString("en-AU")} paid` };
}
