// Jo 24 Oct 2026: "the installer receives the install-day Mitti form by text the morning of". The PIISA Mitti form
// used to be created only by the office button; now the 15-minute tick creates it the day(s) before the install, so
// the 6:30am daily text has a link. Pure "should create now" rule only; creation reuses createPiisaMittiAudit
// (mitti.server.ts), which keeps every guard (form approval, pre-start clear, Ready Check complete, one per job).
import { melbourneYmd } from "./piesa-windows.core";
import { addYmd } from "./melbourne-time.core";

export const PIISA_AUTOSEND_ENABLED = true;
/** Installs from today (until the install starts) up to this many Melbourne days ahead. */
export const PIISA_AUTOSEND_DAYS_AHEAD = 2;
/** F15: a failed attempt is retried about hourly (not a 15-minute loop, and never left until after the install). */
export const PIISA_AUTOSEND_RETRY_AFTER_HOURS = 1;
/** F15: once an attempt has failed with the install today or tomorrow, ONE office item (Needs me "piisa_form_failed"). */
export const PIISA_AUTOSEND_OFFICE_EVENT = "mitti_piisa_autosend_needs_office";
/** Mitti calls are slow and the tick has a 55s limit. */
export const PIISA_AUTOSEND_MAX_PER_TICK = 3;
export const PIISA_AUTOSEND_FAILED_EVENT = "mitti_piisa_autosend_failed";
export const PIISA_AUDIT_CREATED_EVENT = "mitti_piisa_audit_created";
/** TEST jobs (source qa_test) are left to the office button unless a caller explicitly allows the TEST path. */
export const PIISA_AUTOSEND_TEST_ALLOWED = false;

export type PiisaAutoSendFacts = {
  stage: string | null; source: string | null; deleted: boolean; archived: boolean;
  /** Confirmed installation booking start (ISO). */ installStart: string | null;
  /** A mitti_piisa_audit_created event already exists for this job. */ hasPiisaAudit: boolean;
  /** officialFormUseBlocker("piisa") text, or null when the form may be used. */ formBlocker: string | null;
  /** prestartGate(...).locked — fail closed: unknown means locked. */ prestartLocked: boolean;
  /** When the last automatic attempt failed, if any. */ lastFailureAt: string | null;
};
export type PiisaAutoSendDecision = { action: "create" } | { action: "skip"; reason: string };

/** F15: Melbourne day of the install is today .. today + PIISA_AUTOSEND_DAYS_AHEAD, and the install has not started yet
 *  (a booking made late, or a failure the day before, still gets its form on the install morning). */
export function installDayInWindow(installStart: string, now: Date): boolean {
  const today = melbourneYmd(now);
  const day = melbourneYmd(new Date(installStart));
  return day >= today && day <= addYmd(today, PIISA_AUTOSEND_DAYS_AHEAD) && now.getTime() < Date.parse(installStart);
}

/** F15: a failure with the install today or tomorrow (Melbourne) needs the office — the 6:30am text may have no link. */
export function piisaAutoSendOfficeAlertDue(installStart: string, now: Date): boolean {
  return melbourneYmd(new Date(installStart)) <= addYmd(melbourneYmd(now), 1);
}

/** Needs me row: the latest office alert for the job, cleared by a PIISA form created after it. */
export function piisaFormFailedOpen(events: { event_type: string; created_at: string; details?: { message?: string | null } | null }[]): { at: string; text: string } | null {
  const alerts = events.filter((e) => e.event_type === PIISA_AUTOSEND_OFFICE_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const last = alerts[0];
  if (!last) return null;
  if (events.some((e) => e.event_type === PIISA_AUDIT_CREATED_EVENT && e.created_at > last.created_at)) return null;
  const why = last.details?.message?.trim();
  return { at: last.created_at, text: `Install day form not created in Mitti${why ? ` · ${why.slice(0, 120)}` : ""} · create it from the job` };
}

export function piisaAutoSendDecision(f: PiisaAutoSendFacts, now: Date, opts: { enabled?: boolean; allowTest?: boolean } = {}): PiisaAutoSendDecision {
  const skip = (reason: string): PiisaAutoSendDecision => ({ action: "skip", reason });
  if (!(opts.enabled ?? PIISA_AUTOSEND_ENABLED)) return skip("automatic PIISA forms are paused");
  if (f.deleted || f.archived) return skip("removed");
  if (f.hasPiisaAudit) return skip("PIISA form already created");
  if (f.stage !== "installation_booked") return skip("installation not booked");
  if (!f.installStart || !Number.isFinite(Date.parse(f.installStart))) return skip("no install start");
  if (!installDayInWindow(f.installStart, now)) return skip("install is not today (before it starts), tomorrow or the day after");
  if (f.source === "qa_test" && !(opts.allowTest ?? PIISA_AUTOSEND_TEST_ALLOWED)) return skip("TEST job – office button only");
  if (f.formBlocker) return skip(f.formBlocker);
  if (f.prestartLocked) return skip("pre-start check not cleared");
  if (f.lastFailureAt && now.getTime() - Date.parse(f.lastFailureAt) < PIISA_AUTOSEND_RETRY_AFTER_HOURS * 3_600_000) return skip("last attempt failed – retrying within the hour");
  return { action: "create" };
}
