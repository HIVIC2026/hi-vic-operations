import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { USUAL_ELECTRICIAN_EVENT } from "./usual-electrician.core";
import { readUsualElectrician } from "./usual-electrician.server";
import { signupMainElectrician, signupInviteDue, pickSendable, SIGNUP_INVITES_PER_TICK } from "./signup-electrician.core";
import { REC_ONBOARDING_INVITE_EVENT } from "./rec-onboarded.core";

/** On approval: keep the electrician the installer named at sign-up as their usual electrician (unless one is already saved)
 *  and attach that application's electrician nominations to the business. "Nothing to do" returns a reason; DB errors throw. */
export async function carrySignupElectrician(businessId: string, actorId: string | null): Promise<{ saved: boolean; reason?: "no_application" | "no_electrician" | "already_saved" }> {
  const { data: act, error: ae } = await admin.from("partner_activations").select("application_id").eq("business_id", businessId).limit(1).maybeSingle();
  if (ae) throw new Error(`Could not load the sign-up link: ${ae.message}`);
  if (!act?.application_id) return { saved: false, reason: "no_application" };
  const { data: app, error: pe } = await admin.from("rec_onboarding_applications").select("data").eq("id", act.application_id).maybeSingle();
  if (pe) throw new Error(`Could not load the sign-up: ${pe.message}`);
  const electrician = signupMainElectrician(app?.data);
  if (!electrician) return { saved: false, reason: "no_electrician" };
  const { error: ne } = await admin.from("electrician_nominations").update({ nominating_business_id: businessId } as never).eq("installer_application_id", act.application_id).is("nominating_business_id", null);
  if (ne) throw new Error(`Could not link the sign-up electrician nominations: ${ne.message}`);
  if ((await readUsualElectrician(businessId)).electrician) return { saved: false, reason: "already_saved" };
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: USUAL_ELECTRICIAN_EVENT,
    summary: "Usual electrician saved from installer sign-up on approval", details: { business_id: businessId, electrician, source: "installer_signup" } });
  if (error) throw new Error(`Could not save the sign-up electrician: ${error.message}`);
  return { saved: true };
}

/** Tick sweep: send the ONE invite for sign-up electrician nominations that were never sent (comms were off at sign-up).
 *  Same send path as rec-onboarding-invite.server.ts, but the fresh token goes on the EXISTING nomination row (claimed with a
 *  conditional update so overlapping ticks cannot both send). Looks at up to 200 candidates; sends at most 25 per tick. */
export async function sweepSignupNominationInvites(now = new Date()): Promise<{ checked: number; sent: number; skipped: number; failed: number }> {
  const out = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  const { customerCommsEnabled } = await import("./comms.server");
  const commsEnabled = await customerCommsEnabled();
  if (!commsEnabled) return out; // paused comms: nothing to do, retried next tick
  const { data: rows, error } = await admin.from("electrician_nominations")
    .select("id, installer_application_id, contact_name, business_name, email, rec_number, licence_number, status, invite_sent_at, business_id")
    .not("installer_application_id", "is", null).is("job_id", null).eq("status", "invite_pending_comms").is("invite_sent_at", null).is("business_id", null).not("email", "is", null)
    .order("created_at", { ascending: true }).limit(200);
  if (error) throw new Error(`Could not read sign-up electrician invites: ${error.message}`);
  if (!rows?.length) return out;
  out.checked = rows.length;
  const appIds = [...new Set(rows.map((r) => r.installer_application_id as string))];
  const { data: acts, error: ae } = await admin.from("partner_activations").select("application_id, business_id").in("application_id", appIds);
  if (ae) throw new Error(`Could not read sign-up links: ${ae.message}`);
  const bizIds = [...new Set((acts ?? []).map((a) => a.business_id).filter((b): b is string => !!b))];
  const { data: bizs, error: be } = bizIds.length ? await admin.from("businesses").select("id, onboarding_status").in("id", bizIds) : { data: [], error: null };
  if (be) throw new Error(`Could not read installer businesses: ${be.message}`);
  const approved = new Set((bizs ?? []).filter((b) => b.onboarding_status === "approved").map((b) => b.id));
  const installerFor = new Map<string, string>();
  for (const a of acts ?? []) if (a.business_id && approved.has(a.business_id)) installerFor.set(a.application_id as string, a.business_id);
  const ids = rows.map((r) => r.id);
  const { data: evs, error: ee } = await admin.from("admin_config_events").select("details").eq("event_type", REC_ONBOARDING_INVITE_EVENT).in("details->>nomination_id", ids);
  if (ee) throw new Error(`Could not read earlier invites: ${ee.message}`);
  const alreadySent = new Set((evs ?? []).filter((e) => (e.details as { status?: string } | null)?.status === "sent").map((e) => String((e.details as { nomination_id?: string }).nomination_id)));
  const { loadApprovedRecCandidates } = await import("./rec-onboarded.server");
  const { matchUsualElectrician } = await import("./our-lead-piesa-electrician.core");
  const candidates = (await loadApprovedRecCandidates(now)).filter((c) => c.onboarding_status === "approved");
  const { newToken, hashToken } = await import("./worker-links.core");
  const sendable = pickSendable(rows, SIGNUP_INVITES_PER_TICK, (r) => {
    if (alreadySent.has(r.id) || !installerFor.has(r.installer_application_id as string)) return false;
    const matched = matchUsualElectrician({ name: r.business_name || r.contact_name || "", licence: r.rec_number || r.licence_number || "" }, candidates);
    return signupInviteDue({ status: r.status, invite_sent_at: r.invite_sent_at, business_id: r.business_id, email: r.email, installerApproved: true, commsEnabled, electricianAlreadyApproved: !!matched }) === "send";
  });
  out.skipped = rows.length - sendable.length;
  const record = async (summary: string, details: Record<string, unknown>) => {
    try {
      const { error: ie } = await admin.from("admin_config_events").insert({ actor_id: null, event_type: REC_ONBOARDING_INVITE_EVENT, summary, details: details as never });
      if (ie) console.error("sign-up electrician invite: could not record event", ie.message);
    } catch (e) { console.error("sign-up electrician invite: could not record event", (e as Error).message); }
  };
  for (const r of sendable) {
    const installerBusinessId = installerFor.get(r.installer_application_id as string)!;
    const name = (r.contact_name || r.business_name || "").trim();
    try {
      const invite = newToken();
      // Claim: only one tick can win this row (not sent yet, no fresh token issued in the last 10 minutes).
      const cutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
      const { data: claimed, error: ue } = await admin.from("electrician_nominations").update({
        invite_token_hash: await hashToken(invite), invite_link_issued_at: now.toISOString(), invite_expires_at: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
      } as never).eq("id", r.id).eq("status", "invite_pending_comms").is("invite_sent_at", null)
        .or(`invite_link_issued_at.is.null,invite_link_issued_at.lt.${cutoff}`).select("id");
      if (ue) throw new Error(ue.message);
      if (!claimed?.length) { out.skipped++; continue; }
      const { sendElectricianInvite } = await import("./job-electrician-invite.server");
      const s = await sendElectricianInvite({ actorId: null, nominationId: r.id, installerBusinessId, inviteToken: invite, to: r.email!, name });
      await record(`Sign-up electrician invite to ${name} (${s.to}): ${s.status}`, { status: s.status, detail: s.detail ?? null, test: s.test, nomination_id: r.id, source: "installer_signup" });
      if (s.status === "sent") out.sent++; else out.failed++;
    } catch (e) {
      out.failed++;
      await record(`Sign-up electrician invite to ${name} failed: ${(e as Error).message}`, { status: "failed", nomination_id: r.id, source: "installer_signup" });
    }
  }
  return out;
}
