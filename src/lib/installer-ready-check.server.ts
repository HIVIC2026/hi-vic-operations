// Ready Check for installer-supplied customers the installer hasn't quoted (Jo, 7 Oct 6pm).
// Reuses: confirmBooking (stage + approved-installer guard), ready_check_windows and submitReadyCheckWindows
// (owner's 3–5 times), customer_estimate_links (secure owner link), sendTestEmail (TEST allowlist).
// The supplying installer is already assigned, so no offer round runs and no other trade is ever offered the job.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { newToken } from "./worker-links.core";
import {
  OWNER_TIMES_READY, RC_TIMES_EMAIL_APPROVED, RC_TIMES_EMAIL_VERSION, RC_TIMES_LINK_PURPOSE, RC_TIMES_REQUESTED_EVENT, READY_CHECK_BOOKED,
  WAITING_FOR_OWNER_TIMES, installerReadyCheckAction, ownBookingBlocker, renderRcTimesEmail, type InstallerRcAction,
} from "./installer-ready-check.core";

export async function ownerTimesRequested(jobId: string): Promise<boolean> {
  const { data: j } = await admin.from("jobs").select("channel").eq("id", jobId).maybeSingle();
  if (j?.channel !== "installer_sourced") return false;
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", RC_TIMES_REQUESTED_EVENT);
  return !!count;
}

/** Job + the caller's right to act: a member of the installer business that supplied this customer. */
async function load(jobId: string, userId: string) {
  const { data: j } = await admin.from("jobs").select("id, job_number, stage, source, channel, installer_quoted, originating_installer_business_id, owners(full_name, email), businesses:originating_installer_business_id(name, trading_name, onboarding_notes)").eq("id", jobId).maybeSingle();
  if (!j || j.channel !== "installer_sourced" || !j.originating_installer_business_id) throw new WorkflowError("This job isn't one of your supplied customers.");
  const { requireMember } = await import("./pilot.server");
  await requireMember(userId, j.originating_installer_business_id);
  return j;
}

export async function installerRcState(jobId: string) {
  const { data: j, error: je } = await admin.from("jobs").select("channel, stage, installer_quoted, installer_site_check").eq("id", jobId).maybeSingle();
  if (je) throw new WorkflowError("The Ready Check status could not load. Please retry.");
  if (!j) throw new WorkflowError("The Ready Check status could not load: the job was not found."); // never "unknown attendance"
  const [{ readyCheckWindowRound }, requested, { count: booked, error: be }, { count: done, error: de }, { data: m, error: me }] = await Promise.all([
    import("./readycheck-booking.server"), ownerTimesRequested(jobId),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed"),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "completed"),
    admin.from("ceiling_measurements").select("provenance, verified_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  if (be || de || me) throw new WorkflowError("The Ready Check status could not load. Please retry."); // fail closed, never "nothing to do"
  const onsiteDone = (done ?? 0) > 0 || !!(m && (m.verified_area_m2 != null || m.provenance !== "installer_supplied_provisional"));
  const w = await readyCheckWindowRound(jobId);
  const { data: bk, error: bke } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  if (bke) throw new WorkflowError("The Ready Check status could not load. Please retry.");
  const action: InstallerRcAction = installerReadyCheckAction({ channel: j.channel, stage: j.stage, quoted: j.installer_quoted as "yes" | "no" | null, attended: (j.installer_site_check ?? null) as "yes" | "no" | null, onsiteDone, timesRequested: requested, openWindows: w.open.length, booked: !!booked });
  return { action, bookedAt: bk?.scheduled_start ?? null, windows: action === "pick_owner_time" ? w.open.map((x) => ({ id: x.id, starts_at: x.starts_at, ends_at: x.ends_at })) : [] };
}

async function requireAction(jobId: string, want: InstallerRcAction) {
  const s = await installerRcState(jobId);
  if (s?.action !== want) throw new WorkflowError(s?.action === "booked" ? "This Ready Check is already booked." : "This job isn't waiting for that step.");
}

/** Button 1: the installer agreed a time with the owner. Nothing is sent to the owner. */
export async function bookOwnReadyCheck(jobId: string, userId: string, startIso: string) {
  await load(jobId, userId);
  const b = ownBookingBlocker(startIso);
  if (b) throw new WorkflowError(b);
  await requireAction(jobId, "book");
  await (await import("./owner-gates.server")).assertGateA(jobId, "The Ready Check booking");
  const { confirmBooking } = await import("./booking.server");
  await confirmBooking(jobId, "ready_check", new Date(startIso).toISOString(), userId, "installer (time agreed with the owner)");
  await admin.from("jobs").update({ next_action: READY_CHECK_BOOKED }).eq("id", jobId);
  await (await import("./mitti-create.server")).onReadyCheckBooked(jobId, userId).catch((e) => console.error("ready check form not scheduled", (e as Error).message)); // T3: confirmed booking starts the form in the background
  await logEvent(jobId, userId, "installer_ready_check_self_booked", "Installer booked the Ready Check at a time agreed with the owner (nothing sent to the owner)", { starts_at: startIso });
  return { ok: true };
}

/** Button 2: send the owner the pick-your-times link (DRAFT wording, send switches + TEST allowlist). */
export async function askOwnerForReadyCheckTimes(jobId: string, userId: string) {
  const j = await load(jobId, userId);
  await requireAction(jobId, "book");
  const { data: owner } = await admin.from("jobs").select("owner_id").eq("id", jobId).single();
  const token = newToken();
  const { error } = await admin.from("customer_estimate_links").insert({ job_id: jobId, owner_id: owner!.owner_id, purpose: RC_TIMES_LINK_PURPOSE, token, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  if (error) throw new Error(`Could not prepare the owner's link: ${error.message}`);
  const biz = j.businesses as { name: string; trading_name: string | null; onboarding_notes: string | null } | null;
  const businessName = (biz?.trading_name || biz?.name || "Your installer").replace(/^\[TEST PARTNER\]\s*/, "");
  const o = j.owners as { full_name: string | null; email: string | null } | null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const mail = renderRcTimesEmail({ ownerName: o?.full_name ?? null, installerBusiness: businessName, link: `${CUSTOMER_BASE}/times/${token}` });
  await logEvent(jobId, userId, RC_TIMES_REQUESTED_EVENT, `Installer asked Home Insulation Victoria to collect the owner's Ready Check times (${RC_TIMES_EMAIL_VERSION})`, { version: RC_TIMES_EMAIL_VERSION });
  await admin.from("jobs").update({ next_action: WAITING_FOR_OWNER_TIMES }).eq("id", jobId);
  let delivery: string;
  if (j.source === "qa_test") {
    const { sendTestEmail } = await import("./test-send.server");
    const { TEST_ALLOWLIST, isTestPartner } = await import("./test-send.core");
    const r = await sendTestEmail({ jobId, jobSource: j.source, partnerIsTest: isTestPartner(biz), label: "installer Ready Check times", actorId: userId }, TEST_ALLOWLIST.email[0], mail.subject, mail.html, mail.text);
    delivery = `TEST email ${r.status}: ${r.detail}`;
  } else {
    const { customerCommsEnabled, hasCurrentOwnerContactConsent } = await import("./comms.server");
    delivery = !RC_TIMES_EMAIL_APPROVED ? "held: wording waiting for Jo's approval"
      : !(await customerCommsEnabled()) ? "held: customer sending is switched off"
      : !(await hasCurrentOwnerContactConsent(jobId)) ? "held: no current contact consent"
      : "held: real sending for this message is not connected yet";
  }
  await logEvent(jobId, userId, "installer_ready_check_times_delivery", `Owner times link: ${delivery}`, { version: RC_TIMES_EMAIL_VERSION }, { internal: true });
  return { ok: true, delivery, ...(j.source === "qa_test" ? { testLink: `/times/${token}` } : {}) };
}

/** The installer taps one of the owner's times. One tap wins; the rest close. */
export async function takeOwnerReadyCheckTime(jobId: string, userId: string, windowId: string) {
  await load(jobId, userId);
  await requireAction(jobId, "pick_owner_time");
  await (await import("./owner-gates.server")).assertGateA(jobId, "The Ready Check booking"); // check before taking the time
  const nowIso = new Date().toISOString();
  const { data: w } = await admin.from("ready_check_windows").update({ status: "taken", taken_by: userId, taken_at: nowIso })
    .eq("id", windowId).eq("job_id", jobId).eq("status", "open").gt("starts_at", nowIso).select("starts_at").maybeSingle();
  if (!w) throw new WorkflowError("That time is no longer available. Please choose another time.");
  const { confirmBooking } = await import("./booking.server");
  try { await confirmBooking(jobId, "ready_check", w.starts_at, userId, "installer (owner's chosen time)"); }
  catch (e) { await admin.from("ready_check_windows").update({ status: "open", taken_by: null, taken_at: null }).eq("id", windowId); throw e; }
  await admin.from("ready_check_windows").update({ status: "closed" }).eq("job_id", jobId).eq("status", "open");
  await admin.from("jobs").update({ next_action: READY_CHECK_BOOKED }).eq("id", jobId);
  await (await import("./mitti-create.server")).onReadyCheckBooked(jobId, userId).catch((e) => console.error("ready check form not scheduled", (e as Error).message)); // T3: confirmed booking starts the form in the background
  return { ok: true };
}

/** Owner link (no login): only the "Ready Check times" link kind, active and unexpired. */
export async function jobForTimesToken(token: string): Promise<string | null> {
  if (typeof token !== "string" || token.length < 43 || token.length > 200) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", token).eq("purpose", RC_TIMES_LINK_PURPOSE).maybeSingle();
  if (!l || l.status !== "active" || (l.expires_at && Date.parse(l.expires_at) < Date.now())) return null;
  return l.job_id;
}

export async function ownerTimesPage(token: string) {
  const jobId = await jobForTimesToken(token);
  if (!jobId) return null;
  const { data: j } = await admin.from("jobs").select("businesses:originating_installer_business_id(name, trading_name)").eq("id", jobId).maybeSingle();
  const b = j?.businesses as { name: string; trading_name: string | null } | null;
  const { ownerReadyCheckWindowState } = await import("./readycheck-booking.server");
  const s = await ownerReadyCheckWindowState(jobId);
  return { ...s, installer: (b?.trading_name || b?.name || "Your installer").replace(/^\[TEST PARTNER\]\s*/, ""), ownerTimesReady: OWNER_TIMES_READY };
}
