// Part 3 Task 3 (Jo 3 Nov 2026): the job's certificate facts, built from records that already exist — the PIESA answers
// (Task 2 ids: q20 upgrades needed, q30 doing them today, Part C recorded), the upgrades booking, the A4 completion / the
// post_rectification PIESA record, and the certificate as coes-check.server reads it (`currentCoes` + `coesState`). Read-only
// except `recordInstallCertificateWarning` (one office event per install start, Part 3 Task 4): nothing here sends or moves a
// stage. Rules in certificate-later.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  CERTIFICATE_UNREADABLE, INSTALL_CERTIFICATE_WARNING, INSTALL_CERTIFICATE_WARNING_EVENT, certificateState, certificateStatusLine, prestartCertificate,
  type CertificateState, type PrestartCertificate,
} from "./certificate-later.core";

export type CertificateFacts = {
  upgradesNeeded: boolean;
  /** A3 q30 "Are you doing the electrical upgrades today?" = Yes (the A4 merge sets it too, but then Part C is recorded). */
  upgradesToday: boolean;
  /** A confirmed (or completed) upgrades visit booking exists. */
  upgradesDaySet: boolean;
  upgradesDoneAt: string | null;
  partCRecorded: boolean;
  certificateFileAt: string | null;
  certificateTicked: boolean;
  /** The office rejected the current certificate: its note ("" when none). Null = not rejected. */
  certificateRejectedWhy: string | null;
  /** The current certificate's key (coes-check), null when no file. */
  certificateKey: string | null;
  /** Why the current file still needs the office (coes-check.core `coesState` why), null when ticked or no file. */
  certificateWhy: string | null;
  electrician: string | null;
  state: CertificateState;
  /** The job-page status line, or null. */
  line: string | null;
};

type Entry = { label: string; value: string | null };
const entriesOf = (raw: unknown): Entry[] => (Array.isArray(raw) ? (raw as Entry[]).filter((e) => e && typeof e.label === "string") : []);

/** The active electrician's own name (their worker row), else their business, else null. */
export async function electricianNameFor(jobId: string): Promise<{ name: string | null; first: string | null; businessId: string | null; userId: string | null; assignmentId: string | null }> {
  const { data: rows } = await admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at", { ascending: false }).limit(1);
  const a = ((rows ?? []) as { id: string; user_id: string; business_id: string | null }[])[0];
  if (!a) return { name: null, first: null, businessId: null, userId: null, assignmentId: null };
  const [{ data: w }, { data: b }] = await Promise.all([
    a.business_id ? admin.from("partner_workers").select("full_legal_name").eq("business_id", a.business_id).eq("profile_id", a.user_id).is("removed_at", null).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    a.business_id ? admin.from("businesses").select("name, trading_name").eq("id", a.business_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { displayName } = await import("./display-name.core");
  const own = displayName((w as { full_legal_name?: string | null } | null)?.full_legal_name) || null;
  const biz = displayName((b as { trading_name?: string | null; name?: string | null } | null)?.trading_name || (b as { name?: string | null } | null)?.name) || null;
  const name = own || biz;
  return { name, first: own ? own.split(/\s+/)[0]! : null, businessId: a.business_id, userId: a.user_id, assignmentId: a.id };
}

/** Every certificate fact for one job. Never guesses: a missing record reads as "not yet". */
export async function jobCertificateFacts(jobId: string): Promise<CertificateFacts> {
  const [{ data: a }, { data: items }, { data: bk }, { data: rec }, { data: doneEv }, who] = await Promise.all([
    admin.from("assessments").select("mitti_raw_snapshot, completed_at").eq("job_id", jobId).maybeSingle(),
    admin.from("rectification_items").select("status").eq("job_id", jobId).in("status", ["required", "completed"]),
    admin.from("bookings").select("id").eq("job_id", jobId).eq("kind", "rectification").in("status", ["confirmed", "completed"]).limit(1),
    admin.from("piesa_records").select("completed_date, created_at").eq("job_id", jobId).eq("kind", "post_rectification").eq("outcome", "pass").order("created_at", { ascending: false }).limit(1),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "fixes_form_completed").order("created_at", { ascending: false }).limit(1),
    electricianNameFor(jobId),
  ]);
  const entries = entriesOf((a as { mitti_raw_snapshot?: unknown } | null)?.mitti_raw_snapshot);
  const [{ shortAnswersFromEntries }, { piesaRectificationDone }, { fixesFormNeeded }] = await Promise.all([import("./official-short.core"), import("./piesa-evidence.core"), import("./fixes-day.core")]);
  const short = entries.length ? shortAnswersFromEntries("piesa", entries) : null;
  const doneOnForm = !!short && piesaRectificationDone(short);
  const record = ((rec ?? []) as { completed_date: string | null; created_at: string }[])[0] ?? null;
  const upgradesNeeded = short && short["rectificationOutcome"] ? fixesFormNeeded(short) || doneOnForm : (items ?? []).length > 0 || !!record;
  const upgradesToday = !!short && /^yes\b/i.test(String(short["rectificationComplete"] ?? ""));
  const partCRecorded = doneOnForm || !!record;
  const doneDate = ((doneEv ?? []) as { details: { done_date?: string | null } | null }[])[0]?.details?.done_date ?? null;
  const completedAt = (a as { completed_at?: string | null } | null)?.completed_at ?? null;
  // Dates are Melbourne calendar dates (YYYY-MM-DD); a timestamp-shaped read is cut to its date.
  const ymd = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);
  const upgradesDoneAt = partCRecorded ? ymd(record?.completed_date) ?? ymd(doneDate) ?? ymd(completedAt) : null;
  let certificateFileAt: string | null = null, certificateTicked = false, certificateKey: string | null = null, certificateRejectedWhy: string | null = null, certificateWhy: string | null = null;
  if (partCRecorded) {
    const coes = await import("./coes-check.server");
    const c = await coes.currentCoes(jobId);
    if (c.ref?.files.length) {
      certificateKey = c.ref.key;
      certificateFileAt = c.since ?? record?.created_at ?? new Date(0).toISOString();
      const { coesState } = await import("./coes-check.core");
      const { data: evs } = await admin.from("workflow_events").select("id, event_type, created_at, details").eq("job_id", jobId).in("event_type", ["coes_checked", "coes_rejected"]).order("created_at", { ascending: true });
      const st = coesState((evs ?? []) as never, c.ref.key);
      certificateTicked = st.state === "ticked";
      certificateWhy = certificateTicked ? null : st.why;
      // Rejected by the office: the electrician's link asks for a new one, with the office's note.
      if (st.state === "rejected") {
        const last = ((evs ?? []) as { id?: string; details: Record<string, unknown> | null }[]).find((e) => e.id === st.eventId);
        const note = last?.details?.["note"];
        certificateRejectedWhy = typeof note === "string" ? note : "";
      }
    }
  }
  const upgradesDaySet = ((bk ?? []) as unknown[]).length > 0;
  const state = certificateState({ upgradesNeeded, upgradesDoneAt, partCRecorded, certificateFileAt, certificateTicked, certificateRejectedWhy });
  return { upgradesNeeded, upgradesToday, upgradesDaySet, upgradesDoneAt, partCRecorded, certificateFileAt, certificateTicked, certificateRejectedWhy, certificateKey, certificateWhy, electrician: who.name, state, line: certificateStatusLine({ state, electrician: who.name, upgradesDaySet }) };
}

/** The job-page status line only (installer + office pages). Never throws: a failed read shows nothing rather than a wrong line. */
export async function certificateLineFor(jobId: string): Promise<{ state: CertificateState; line: string | null } | null> {
  try { const f = await jobCertificateFacts(jobId); return { state: f.state, line: f.line }; } catch (e) { console.error("certificate facts not read", jobId, (e as Error).message); return null; }
}

// ---------- Part 3 Task 4 (Jo 3 Nov 2026): the install can be booked, not started, without the certificate ----------

/** The pre-start certificate fact (prestart.server `prestartFacts`). `onsiteOnly` = the job clears on the electrician at the
 *  start of the install day (clear after the PIESA). Fails closed: a read failure is "unchecked" (the pre-start fails). */
export async function prestartCertificateFacts(jobId: string, opts: { onsiteOnly: boolean }): Promise<{ certificate: PrestartCertificate; certificateWhy: string | null; state: CertificateState | null }> {
  if (opts.onsiteOnly) return { certificate: "not_needed", certificateWhy: null, state: null };
  try {
    const f = await jobCertificateFacts(jobId);
    // An odd job the new facts call "no upgrades" but the existing certificate check still asks for one: that check stands.
    const legacyWhy = f.state === "none_needed" ? await (await import("./coes-check.server")).coesWhyFor(jobId) : null;
    const r = prestartCertificate({ onsiteOnly: false, state: f.state, rejected: f.certificateRejectedWhy != null, why: f.certificateWhy, legacyWhy });
    return { certificate: r.certificate, certificateWhy: r.why, state: f.state };
  } catch (e) {
    console.error("certificate facts not read for the pre-start check", jobId, (e as Error).message);
    return { certificate: "unchecked", certificateWhy: CERTIFICATE_UNREADABLE, state: null };
  }
}

/** The warning for an install booking: the certificate is outstanding (the pre-start check would fail on it), else null. */
export async function installCertificateWarningFor(jobId: string): Promise<string | null> {
  const { clearanceFacts } = await import("./electrical-clearance.server");
  const onsiteOnly = (await clearanceFacts(jobId).catch(() => null))?.onsiteStartOnly === true;
  const c = await prestartCertificateFacts(jobId, { onsiteOnly });
  return c.certificate === "missing" || c.certificate === "unchecked" ? INSTALL_CERTIFICATE_WARNING : null;
}

/** After an install booking: record the warning once per install start (office history) and return it for the screen.
 *  Never throws — a booking is never undone by this. */
export async function recordInstallCertificateWarning(jobId: string, actorId: string | null, startIso: string): Promise<string | null> {
  try {
    const warning = await installCertificateWarningFor(jobId);
    if (!warning) return null;
    const start = new Date(startIso).toISOString();
    const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_CERTIFICATE_WARNING_EVENT);
    if (error) throw new Error(error.message);
    const seen = ((data ?? []) as { details: { scheduled_start?: string } | null }[]).some((e) => e.details?.scheduled_start && new Date(e.details.scheduled_start).toISOString() === start);
    if (!seen) {
      const { logEvent } = await import("./workflow.server");
      await logEvent(jobId, actorId, INSTALL_CERTIFICATE_WARNING_EVENT, `Install booked: ${warning}`, { scheduled_start: start, warning }, { internal: true });
    }
    return warning;
  } catch (e) {
    console.error("install certificate warning not recorded", jobId, (e as Error).message);
    return null;
  }
}
