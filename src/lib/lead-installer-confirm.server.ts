// Part 7 Task 6: the 9am two-days-before Lead Installer email (sweep, 15-minute allocation tick) and the 5pm lock the
// install writers check. Wording/timing: lead-installer-confirm.core.ts; the clock: prestart.core (Part 9's rule).
// Every confirmed installation booking within LEAD_CONFIRM_LOOKAHEAD_DAYS, ALL installers (not only in-house), ONE email
// per job + install date to the installer business's office email. TEST job / TEST partner → test-send; real → nothing
// until LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED, customer comms on and the trade pause lifted (held, recorded once as
// `lead_installer_confirm_held`, key not claimed); then the existing guarded partner sender. The claim
// (`lead_installer_confirm_email`, with the key) is written only after the sender reports `sent` — the sender's own
// Resend Idempotency-Key (= the key) guards a double send, so a blocked/failed send claims nothing, records the hold
// once and is retried next tick. A read failure logs and sends nothing. Never changes a booking, a crew or a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import {
  LEAD_CONFIRM_EVENT, LEAD_CONFIRM_HELD_EVENT, LEAD_CONFIRM_LOOKAHEAD_DAYS, LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED, leadConfirmDue, leadConfirmInstallYmd, leadConfirmKey,
  renderLeadInstallerConfirm,
} from "./lead-installer-confirm.core";
import { LEAD_LOCKED_MESSAGE, leadInstallerLock, leadInstallerLocked } from "./prestart.core";

type Booking = { id: string; job_id: string; scheduled_start: string; created_at: string | null };
const PAGE = 200;

export async function sweepLeadInstallerConfirm(now = new Date(), opts: { approved?: boolean } = {}): Promise<{ checked: number; sent: number; held: number }> {
  const approved = opts.approved ?? LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED;
  const until = new Date(now.getTime() + LEAD_CONFIRM_LOOKAHEAD_DAYS * 86_400_000).toISOString();
  const out = { checked: 0, sent: 0, held: 0 };
  const bookings: Booking[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("bookings").select("id, job_id, scheduled_start, created_at").eq("kind", "installation").eq("status", "confirmed")
      .gte("scheduled_start", now.toISOString()).lte("scheduled_start", until).order("scheduled_start", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { console.error("lead installer confirm sweep: bookings could not be read", error.message); return out; }
    bookings.push(...((data ?? []) as Booking[]));
    if ((data ?? []).length < PAGE) break;
  }
  // Part 7 Task 8: an install day that already got the retired 2pm "Tomorrow's installs — Lead Installer" office email
  // (claim `in-house-install-office:v1:{business}:{day}`, status sent) never gets this one as well. Read once, batched.
  const oldSent = await oldOfficeEmailDays(bookings);
  for (const b of bookings) {
    out.checked++;
    try {
      const r = oldSent.has(`${b.job_id}:${leadConfirmInstallYmd(b.scheduled_start)}`) ? "skipped: old 2pm office email already sent for this install day" : await confirmOne(b, now, approved);
      if (r.startsWith("email")) out.sent++;
      else if (r.startsWith("held")) out.held++;
    } catch (e) { console.error("lead installer confirm email failed", b.job_id, (e as Error).message); }
  }
  return out;
}

/** `${jobId}:${installYmd}` for every booking whose business already got the retired 2pm email for that day (one batched read). */
async function oldOfficeEmailDays(bookings: Booking[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!bookings.length) return out;
  const jobIds = [...new Set(bookings.map((b) => b.job_id))];
  const { data: asg, error } = await admin.from("job_assignments").select("job_id, business_id").in("job_id", jobIds).eq("role", "installer").eq("active", true);
  if (error) throw new Error(error.message);
  const bizOf = new Map((asg ?? []).map((a) => [String(a.job_id), String(a.business_id)]));
  const { stableUuid } = await import("./mitti-create-claim.core");
  const wanted: { id: string; tag: string }[] = [];
  for (const b of bookings) {
    const biz = bizOf.get(b.job_id);
    if (!biz) continue;
    const day = leadConfirmInstallYmd(b.scheduled_start);
    wanted.push({ id: await stableUuid(`in-house-install-office:v1:${biz}:${day}`), tag: `${b.job_id}:${day}` });
  }
  if (!wanted.length) return out;
  const { data: claims, error: ce } = await admin.from("workflow_events").select("id, details").in("id", wanted.map((w) => w.id));
  if (ce) throw new Error(ce.message);
  const sent = new Set((claims ?? []).filter((c) => (c.details as { status?: string } | null)?.status === "sent").map((c) => String(c.id)));
  for (const w of wanted) if (sent.has(w.id)) out.add(w.tag);
  return out;
}

async function once(jobId: string, type: string, key: string): Promise<boolean> {
  const { data, error } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", type).contains("details", { key }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function confirmOne(b: Booking, now: Date, approved: boolean): Promise<string> {
  const day = leadConfirmInstallYmd(b.scheduled_start);
  const key = leadConfirmKey(b.job_id, day);
  const due = leadConfirmDue({ startIso: b.scheduled_start, bookedAt: b.created_at ?? b.scheduled_start, now });
  if (due !== "send") return `skipped: ${due}`;
  if (await once(b.job_id, LEAD_CONFIRM_EVENT, key)) return "skipped: already sent";
  const [{ data: job }, { data: asg }, { data: crewEv }, { data: allocEv }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, deleted_at, owners(full_name), properties(address_line, suburb, postcode)").eq("id", b.job_id).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", b.job_id).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", b.job_id).eq("event_type", "piisa_crew_selected").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", b.job_id).eq("event_type", "visit_allocated").order("created_at", { ascending: false }).limit(20),
  ]);
  const j = job as { id: string; job_number: string; source: string | null; deleted_at: string | null; owners: { full_name: string | null } | { full_name: string | null }[] | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null } | null;
  if (!j || j.deleted_at) return "skipped: job not found";
  const bizId = (asg as { business_id: string | null } | null)?.business_id ?? null;
  if (!bizId) return "skipped: no installer assigned";
  const { data: biz } = await admin.from("businesses").select("id, name, email, onboarding_notes").eq("id", bizId).maybeSingle();
  const bz = biz as { id: string; name: string | null; email: string | null; onboarding_notes: string | null } | null;
  const to = bz?.email?.trim().toLowerCase() ?? "";
  if (!to) return "skipped: installer business has no office email";
  // The Lead Installer: the current install allocation, else the saved crew's lead; crew = the saved crew's additional members.
  const { currentAllocation } = await import("./visit-allocation.core");
  const cur = currentAllocation(((allocEv ?? []) as { event_type?: string; details: unknown; created_at: string }[]).map((e) => ({ event_type: "visit_allocated", details: e.details, created_at: e.created_at })), "install");
  const sel = (crewEv as { details: { selection?: { lead?: unknown; additional?: unknown[] } } | null } | null)?.details?.selection ?? null;
  const { leadWorkerId } = await import("./piisa-a3.core");
  const leadId = cur?.worker_id ?? (sel ? leadWorkerId(sel as never) : null);
  const additional = Array.isArray(sel?.additional) ? sel!.additional! : [];
  const crewIds = additional.map((a) => (typeof a === "string" ? a : (a as { workerId?: string; other?: { name?: string } })?.workerId ?? null)).filter((x): x is string => !!x);
  const otherNames = additional.map((a) => (a && typeof a === "object" && "other" in (a as object) ? String((a as { other: { name?: string } }).other?.name ?? "").trim() : "")).filter(Boolean);
  const ids = [leadId, ...crewIds].filter((x): x is string => !!x);
  const { data: workers } = ids.length ? await admin.from("partner_workers").select("id, full_legal_name").in("id", ids) : { data: [] };
  const nameOf = (id: string | null) => (id ? ((workers ?? []) as { id: string; full_legal_name: string | null }[]).find((w) => w.id === id)?.full_legal_name ?? null : null);
  const lead = nameOf(leadId);
  const crew = [...crewIds.map(nameOf).filter((x): x is string => !!x), ...otherNames];
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(bz ?? {});
  const test = j.source === "qa_test" || partnerIsTest;
  const hold = async (reason: string) => {
    if (!(await once(j.id, LEAD_CONFIRM_HELD_EVENT, key))) await logEvent(j.id, null, LEAD_CONFIRM_HELD_EVENT, `Lead Installer confirm email held: ${reason}`, { key, install_date: day, booking_id: b.id, business_id: bz!.id, reason }, { internal: true });
    return `held: ${reason}`;
  };
  if (!test) {
    // Real installer offices: held (recorded once per key) until Jo approves the wording, while customer comms are off
    // (the sender would block the email anyway) and while trade messages are paused.
    const { customerCommsEnabled } = await import("./comms.server");
    const reason = !approved ? "wording not approved yet"
      : !(await customerCommsEnabled()) ? "customer communications are off"
      : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: bz!.id });
    if (reason) return hold(reason);
  }
  const p = j.properties;
  const address = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ") || j.job_number;
  const owner = (Array.isArray(j.owners) ? j.owners[0] : j.owners)?.full_name ?? "";
  const { TEST_APP_BASE } = await import("./test-send.server");
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const mail = renderLeadInstallerConfirm({ jobNumber: j.job_number, owner, startIso: b.scheduled_start, address, lead, crew, jobUrl: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/${j.id}`, lockLabel: leadInstallerLock(b.scheduled_start).lockLabel, test });
  const claim = () => logEvent(j.id, null, LEAD_CONFIRM_EVENT, `Lead Installer confirm email to the installer office for the ${day} install`, { key, install_date: day, booking_id: b.id, business_id: bz!.id, to, test, lead_worker_id: leadId }, { internal: true });
  if (test) {
    // TEST sends are recorded once before the send (the test sender has no idempotency key of its own).
    await claim();
    const { sendTestEmail } = await import("./test-send.server");
    const r = await sendTestEmail({ jobId: j.id, jobSource: j.source, partnerIsTest, label: `lead_installer_confirm:${day}`, actorId: null }, to, mail.subject, mail.html, mail.text);
    return `email (test) ${r.status}: ${r.detail}`;
  }
  const { sendOfficeEmail } = await import("./office-email.server");
  const r = await sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: bz!.name, subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: key, record: { businessId: bz!.id }, idempotencyKey: key });
  // Fix I1: the sender can still block (comms off, trade pause, recipient rule) or fail; only a sent email claims the key.
  // The sender's Idempotency-Key = key keeps a retry from sending twice.
  if (r.status !== "sent") return hold(r.status === "blocked" ? r.detail : `send failed: ${r.detail}`);
  await claim();
  return `email ${r.status}: ${r.detail}`;
}

// ── the 5pm lock on the writers ───────────────────────────────────────────────────────────────────────────────────
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
