import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { USUAL_ELECTRICIAN_EVENT } from "./usual-electrician.core";
import { readUsualElectrician } from "./usual-electrician.server";
import { signupMainElectrician, signupInviteDue, signupMainNominationIds, pickSendable, SIGNUP_INVITES_PER_TICK } from "./signup-electrician.core";
import { REC_ONBOARDING_INVITE_EVENT } from "./rec-onboarded.core";

/** On approval: keep the electrician the installer named at sign-up as their usual electrician (unless one is already saved)
 *  and attach that application's electrician nominations to the business. "Nothing to do" returns a reason; DB errors throw. */
export async function carrySignupElectrician(businessId: string, actorId: string | null): Promise<{ saved: boolean; reason?: "no_application" | "no_electrician" | "already_saved" }> {
  const { data: act, error: ae } = await admin.from("partner_activations").select("application_id").eq("business_id", businessId).eq("partner_type", "installer")
    .order("activated_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
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

/** Tick sweep: send the ONE invite for the main sign-up electrician nomination that was never sent (comms were off at sign-up).
 *  Same send path as rec-onboarding-invite.server.ts, but the fresh token goes on the EXISTING nomination row (claimed with a
 *  conditional update on "no link issued yet", so overlapping ticks or an office-issued link are never taken over).
 *  Only installers whose sign-up electrician was saved (on approval or by the one-off fix) - that is the gate. Every attempt is
 *  recorded once and is final (never retried). Runs before the decision-303 sweep in the tick. Looks at up to 200 candidates;
 *  sends at most 25 per tick. */
export async function sweepSignupNominationInvites(now = new Date()): Promise<{ checked: number; sent: number; skipped: number; failed: number }> {
  const out = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  const { customerCommsEnabled } = await import("./comms.server");
  // Jo 30 Oct 2026: "Pause all trade messages" counts as paused comms here (nothing claimed, retried next tick).
  const commsEnabled = (await customerCommsEnabled()) && !(await (await import("./trade-pause.server")).tradeMessagesPausedNow());
  if (!commsEnabled) return out; // paused comms: nothing to do, retried next tick
  const { data: rows, error } = await admin.from("electrician_nominations")
    .select("id, installer_application_id, contact_name, business_name, email, rec_number, licence_number, status, invite_sent_at, invite_link_issued_at, business_id")
    .not("installer_application_id", "is", null).is("job_id", null).eq("status", "invite_pending_comms").is("invite_sent_at", null).is("invite_link_issued_at", null).is("business_id", null).not("email", "is", null)
    .order("created_at", { ascending: true }).limit(200);
  if (error) throw new Error(`Could not read sign-up electrician invites: ${error.message}`);
  if (!rows?.length) return out;
  out.checked = rows.length;
  const appIds = [...new Set(rows.map((r) => r.installer_application_id as string))];
  // The main nomination per application is decided over ALL that application's sign-up nominations, not only the unsent ones.
  const { data: appNoms, error: me } = await admin.from("electrician_nominations").select("id, installer_application_id, is_primary, created_at").in("installer_application_id", appIds).is("job_id", null);
  if (me) throw new Error(`Could not read sign-up electricians: ${me.message}`);
  const mainIds = signupMainNominationIds(appNoms ?? []);
  const { data: acts, error: ae } = await admin.from("partner_activations").select("application_id, business_id, activated_at").in("application_id", appIds).eq("partner_type", "installer")
    .order("activated_at", { ascending: false });
  if (ae) throw new Error(`Could not read sign-up links: ${ae.message}`);
  const bizIds = [...new Set((acts ?? []).map((a) => a.business_id).filter((b): b is string => !!b))];
  const { data: bizs, error: be } = bizIds.length ? await admin.from("businesses").select("id, onboarding_status").in("id", bizIds) : { data: [], error: null };
  if (be) throw new Error(`Could not read installer businesses: ${be.message}`);
  const approved = new Set((bizs ?? []).filter((b) => b.onboarding_status === "approved").map((b) => b.id));
  const installerFor = new Map<string, string>();
  for (const a of acts ?? []) if (a.business_id && approved.has(a.business_id) && !installerFor.has(a.application_id as string)) installerFor.set(a.application_id as string, a.business_id);
  const installerIds = [...new Set(installerFor.values())];
  // Gate: the installer's latest sign-up usual-electrician event is a save (not an undo).
  const { data: saves, error: se } = installerIds.length
    ? await admin.from("admin_config_events").select("details, created_at").eq("event_type", USUAL_ELECTRICIAN_EVENT).in("details->>source", ["installer_signup", "installer_signup_undo"]).in("details->>business_id", installerIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (se) throw new Error(`Could not read sign-up electrician saves: ${se.message}`);
  const latestSource = new Map<string, string>();
  for (const e of saves ?? []) { const d = (e.details ?? {}) as { business_id?: string; source?: string }; if (d.business_id && !latestSource.has(d.business_id)) latestSource.set(d.business_id, String(d.source)); }
  // Another nomination by the same installer for the same email that was already invited (e.g. the decision-303 sweep).
  const { data: sentNoms, error: ne } = installerIds.length
    ? await admin.from("electrician_nominations").select("id, nominating_business_id, email").in("nominating_business_id", installerIds).not("invite_sent_at", "is", null).not("email", "is", null)
    : { data: [], error: null };
  if (ne) throw new Error(`Could not read earlier electrician invites: ${ne.message}`);
  const sentKey = (biz: string, email: string) => `${biz}|${email.trim().toLowerCase()}`;
  const sentTo = new Map<string, string[]>();
  for (const n of sentNoms ?? []) if (n.nominating_business_id && n.email) { const k = sentKey(n.nominating_business_id, n.email); sentTo.set(k, [...(sentTo.get(k) ?? []), n.id]); }
  const ids = rows.map((r) => r.id);
  const { data: evs, error: ee } = await admin.from("admin_config_events").select("details").eq("event_type", REC_ONBOARDING_INVITE_EVENT).in("details->>nomination_id", ids);
  if (ee) throw new Error(`Could not read earlier invites: ${ee.message}`);
  // Any earlier record (sent, failed, blocked, skipped) is final: one record per nomination, never retried.
  const recorded = new Set((evs ?? []).map((e) => String((e.details as { nomination_id?: string } | null)?.nomination_id ?? "")));
  const { loadApprovedRecCandidates } = await import("./rec-onboarded.server");
  const { matchUsualElectrician } = await import("./our-lead-piesa-electrician.core");
  const candidates = (await loadApprovedRecCandidates(now)).filter((c) => c.onboarding_status === "approved");
  const { newToken, hashToken } = await import("./worker-links.core");
  const sendable = pickSendable(rows, SIGNUP_INVITES_PER_TICK, (r) => {
    const installer = installerFor.get(r.installer_application_id as string);
    if (!installer) return false;
    const matched = matchUsualElectrician({ name: r.business_name || r.contact_name || "", licence: r.rec_number || r.licence_number || "" }, candidates);
    return signupInviteDue({ status: r.status, invite_sent_at: r.invite_sent_at, invite_link_issued_at: r.invite_link_issued_at, business_id: r.business_id, email: r.email,
      installerApproved: true, commsEnabled, electricianAlreadyApproved: !!matched, isMain: mainIds.has(r.id), installerSignupSaved: latestSource.get(installer) === "installer_signup",
      earlierSweepRecord: recorded.has(r.id), sameEmailAlreadySent: (sentTo.get(sentKey(installer, r.email ?? "")) ?? []).some((id) => id !== r.id) }) === "send";
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
      // Claim: only one tick can win this row, and only while no link has been issued (an office-issued link is never taken over).
      const { data: claimed, error: ue } = await admin.from("electrician_nominations").update({
        invite_token_hash: await hashToken(invite), invite_link_issued_at: now.toISOString(), invite_expires_at: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
      } as never).eq("id", r.id).eq("status", "invite_pending_comms").is("invite_sent_at", null).is("invite_link_issued_at", null).select("id");
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
