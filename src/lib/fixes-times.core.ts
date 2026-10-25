// Decision 315 (Jo 25 Oct 2026): electricians do the PIESA in the Mitti A3 form, so the old portal "Complete PIESA" step that
// asked for the electrical fixes times (3–5 windows + estimated hours) is never reached. When the A3 sync sees the PIESA
// completed AND repair work is needed (and not fixed on the same visit) AND no electrician fixes windows exist yet, the
// assigned electrician gets ONE text with a link to their job page (/field/{jobId}#fixes-times) to pick the times there.
// Pure: the decision, the key, the wording, the link, the quote hold and the 24h Needs me rule. No I/O.
import { fixesFormNeeded } from "./fixes-day.core";
import { onsiteStartTicked, repairWorkBesidesOnsite } from "./official-short.core";

/** Recorded once per job + PIESA (A3 audit) BEFORE anything is sent (details: { key, audit_id, completed_at, business_id, to }). */
export const FIXES_TIMES_LINK_EVENT = "fixes_times_link_sent" as const;
/** The SAME event the old portal path writes when the electrician gives the windows (portal.functions completeAssessment). */
export const FIXES_TIMES_GIVEN_EVENT = "rectification_windows_given" as const;
/** The real-sender message type (sms.core SMS_MESSAGE_TYPES). */
export const FIXES_TIMES_SMS_TYPE = "fixes_times_link" as const;
/** The job-page anchor the link opens on (FixesTimesCard). */
export const FIXES_TIMES_ANCHOR = "fixes-times";

/** One text per job and PIESA form (a re-sync or the 15-minute tick never texts again; a re-done PIESA has a new audit). */
export const fixesTimesLinkKey = (jobId: string, piesaAuditId: string) => `fixes-times-link:v1:${jobId}:${piesaAuditId}`;

/** The authenticated electrician job page, scrolled to the fixes times card. */
export const fixesTimesLink = (base: string, jobId: string) => `${base.replace(/\/+$/, "")}/field/${jobId}#${FIXES_TIMES_ANCHOR}`;

/** Decision 315 wording (Jo approved the route, 25 Oct 2026). The sender adds "Home Insulation Victoria: ". */
export function fixesTimesLinkText(f: { address: string | null; link: string }): string {
  return `Your safety check at ${f.address?.trim() || "the property"} needs electrical fixes. Please pick 3 to 5 times you can do the work: ${f.link}`;
}

// ---- Decision 314: "Be on site at the start of the install day" as the ONLY repair tick = no fixes visit, no times ----
/** The A3's only repair tick is "Be on site at the start of the install day" (official-short.core `fixesWorkTicks`): the
 *  electrician attends the install day instead of a fixes visit. Any other tick alongside it still needs the times. */
export function onsiteStartOnly(short: Record<string, unknown>): boolean {
  return onsiteStartTicked(short) && !repairWorkBesidesOnsite(short);
}

/** Does this PIESA need the electrician's fixes times? The existing rectification-needed reading (fixes-day.core
 *  `fixesFormNeeded`: repair work needed and not fixed on the same visit), never for the decision-314 on-site-only answer. */
export function fixesTimesNeeded(short: Record<string, string | null | undefined>): boolean {
  return fixesFormNeeded(short) && !onsiteStartOnly(short);
}

export type FixesTimesLinkFacts = {
  deleted: boolean;
  /** The A3 sync saw the PIESA completed in Mitti (with its evidence). */
  piesaCompleted: boolean;
  timesNeeded: boolean;
  /** Any electrician fixes window (appointment_proposals kind rectification, electrician_window) already exists. */
  windowsExist: boolean;
  /** A `fixes_times_link_sent` event already exists for this job + PIESA form. */
  alreadySent: boolean;
  electricianAssigned: boolean;
};
/** Why no text goes now (null = send). Once per job + PIESA; never once the times are in. */
export function fixesTimesLinkBlocker(f: FixesTimesLinkFacts): string | null {
  if (f.deleted) return "job closed";
  if (!f.piesaCompleted) return "PIESA not completed in Mitti";
  if (!f.timesNeeded) return "no electrical fixes visit needed";
  if (f.windowsExist) return "fixes times already given";
  if (f.alreadySent) return "already texted";
  if (!f.electricianAssigned) return "no electrician assigned";
  return null;
}

/** Quote hold (shown on the office fixes quote card; Send refuses while it applies). */
export const FIXES_TIMES_HOLD_REASON = "Waiting for the electrician's fixes times";
export function fixesTimesHoldReason(f: { timesNeeded: boolean; windowsExist: boolean }): string | null {
  return f.timesNeeded && !f.windowsExist ? FIXES_TIMES_HOLD_REASON : null;
}

/** What the electrician's job page shows (electricians only; the server decides the role). */
export type FixesTimesCardState = { show: false } | { show: true; given: boolean };
export function fixesTimesCardState(f: { electrician: boolean; timesNeeded: boolean; piesaCompleted: boolean; linkSent: boolean; windowsExist: boolean }): FixesTimesCardState {
  if (!f.electrician) return { show: false };
  if (f.windowsExist) return { show: true, given: true };
  if (!f.timesNeeded || !(f.piesaCompleted || f.linkSent)) return { show: false };
  return { show: true, given: false };
}

// ---- Needs me: 24h after the link with no times → ONE row (derived from events, cleared by the times) ----
export const FIXES_TIMES_OVERDUE_HOURS = 24;
export const FIXES_TIMES_MISSING_LINE = "Electrician hasn't given fixes times";
type Ev = { job_id: string; created_at: string };
/** Jobs whose latest fixes-times link is 24h+ old and has no `rectification_windows_given` at or after it. */
export function fixesTimesMissing(i: { links: readonly Ev[]; given: readonly Ev[]; now: number }): Map<string, { at: string }> {
  const latestLink = new Map<string, string>();
  for (const l of i.links) if (!latestLink.has(l.job_id) || l.created_at > latestLink.get(l.job_id)!) latestLink.set(l.job_id, l.created_at);
  const out = new Map<string, { at: string }>();
  for (const [jobId, at] of latestLink) {
    const t = Date.parse(at);
    if (!Number.isFinite(t) || i.now - t < FIXES_TIMES_OVERDUE_HOURS * 3_600_000) continue;
    if (i.given.some((g) => g.job_id === jobId && g.created_at >= at)) continue;
    out.set(jobId, { at });
  }
  return out;
}
