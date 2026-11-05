// Deep Part 5a (Jo 4–5 Nov 2026): the Lead Installer lock the install writers check — the ONE rule in prestart.core
// (lead-installer-lock.core: 2 days before the install start, Melbourne wall-clock). The Part 7 Task 6 9am
// "Confirm or change your Lead Installer by 5pm today" sweep that lived here is RETIRED (5 Nov 2026): the 3-day
// "Pick the Lead Installer" reminder + the 2-day red Needs me flag (lead-installer-reminder.server) replace it, and the
// GO / DON'T START email (go-email.server) is the only day-before office email. Old `lead_installer_confirm_email` /
// `lead_installer_confirm_held` events stay as history. The file keeps its name because every writer imports the lock
// helpers from here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { LEAD_LOCKED_MESSAGE, leadInstallerLocked } from "./prestart.core";

// ── the lock on the writers (2 days before the install start) ───────────────────────────────────────────────────
/** The CURRENT confirmed install booking and Lead Installer, read fresh (never a page's copy). */
export async function leadInstallerLockState(jobId: string, now = new Date()): Promise<{ locked: boolean; start: string | null; bookingId: string | null; leadId: string | null }> {
  // Part 9 Task 9: the lockable booking ignores a completed install and throws on a read error (fail closed); the event
  // reads fail closed too — a lock state is never "unlocked" because something couldn't be read.
  const { currentLockableInstallBooking } = await import("./install-booking.server");
  const [b, { data: allocEv, error: ae }, { data: crewEv, error: ce }] = await Promise.all([
    currentLockableInstallBooking(jobId).catch((e: Error) => { throw new WorkflowError(`Could not check the install booking: ${e.message}`); }),
    admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", "visit_allocated").order("created_at", { ascending: false }).limit(20),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_crew_selected").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (ae) throw new WorkflowError(`Could not check the Lead Installer: ${ae.message}`);
  if (ce) throw new WorkflowError(`Could not check the crew: ${ce.message}`);
  const { currentAllocation } = await import("./visit-allocation.core");
  const cur = currentAllocation(((allocEv ?? []) as { details: unknown; created_at: string }[]).map((e) => ({ event_type: "visit_allocated", details: e.details, created_at: e.created_at })), "install");
  const { leadWorkerId } = await import("./piisa-a3.core");
  const sel = (crewEv as { details: { selection?: unknown } | null } | null)?.details?.selection ?? null;
  const leadId = cur?.worker_id ?? (sel ? leadWorkerId(sel as never) : null);
  return { locked: !!b && leadInstallerLocked(b.scheduled_start, now), start: b?.scheduled_start ?? null, bookingId: b?.id ?? null, leadId };
}

/** Refuses (LEAD_LOCKED_MESSAGE) a Lead Installer change or an install-time move once the current install is locked.
 *  Crew-only changes, a first Lead, the same Lead or the same start are never refused. */
export async function assertLeadInstallerUnlocked(jobId: string, change: { newLeadId?: string | null; newStart?: string | null }, now = new Date()): Promise<void> {
  const s = await leadInstallerLockState(jobId, now);
  if (!s.locked || !s.start) return;
  const leadChange = !!change.newLeadId && !!s.leadId && change.newLeadId !== s.leadId;
  const timeChange = !!change.newStart && !Number.isNaN(Date.parse(change.newStart)) && Date.parse(change.newStart) !== Date.parse(s.start);
  if (leadChange || timeChange) throw new WorkflowError(LEAD_LOCKED_MESSAGE);
}
