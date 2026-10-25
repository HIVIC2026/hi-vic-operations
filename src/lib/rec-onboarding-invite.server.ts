// Decision 303 (Jo 25 Oct 2026): ONE REC onboarding invite per electrician an installer named who is not an approved REC.
// Runs on the 15-minute tick only (never from the quote pipeline, which sits on the autoAdvance graph): reads the
// `electrician_onboarding_needed` facts the pipeline recorded, applies the pure `recInviteDecision` (comms master switch,
// earlier issue/attempt, open nomination, email on file) and sends through the EXISTING manual invite path
// (`job-electrician-invite.server.ts`: nomination row + token, TEST business → test inbox). Every decision is recorded once
// per electrician key as an append-only `rec_onboarding_invite` config event, so a re-run never sends twice.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { ELECTRICIAN_ONBOARDING_NEEDED_EVENT, INVITE_SKIP_TEXT, REC_ONBOARDING_INVITE_EVENT, REC_ONBOARDING_INVITE_LABEL, electricianInviteKey, recInviteDecision, type NotOnboardedElectrician } from "./rec-onboarded.core";

type Need = NotOnboardedElectrician & { jobIds: string[]; since: string };

/** Open installer jobs' latest onboarding-needed facts, grouped per electrician key. */
async function pendingElectricians(since: string): Promise<Map<string, Need>> {
  const { data: evs, error } = await admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", ELECTRICIAN_ONBOARDING_NEEDED_EVENT).gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error("Could not read electrician onboarding facts.");
  const latestPerJob = new Map<string, { created_at: string; details: Record<string, unknown> }>();
  for (const e of evs ?? []) if (e.job_id && !latestPerJob.has(e.job_id)) latestPerJob.set(e.job_id, { created_at: e.created_at, details: (e.details as Record<string, unknown>) ?? {} });
  const jobIds = [...latestPerJob.keys()];
  if (!jobIds.length) return new Map();
  const { data: jobs } = await admin.from("jobs").select("id, stage, deleted_at, qa_archived_at").in("id", jobIds);
  const { isClosedOrArchivedJob } = await import("./mitti.core");
  const open = new Set((jobs ?? []).filter((j) => !isClosedOrArchivedJob(j)).map((j) => j.id));
  const out = new Map<string, Need>();
  for (const [jobId, e] of latestPerJob) {
    if (!open.has(jobId)) continue;
    const d = e.details;
    const name = typeof d["name"] === "string" ? d["name"].trim() : "";
    const biz = typeof d["installer_business_id"] === "string" ? d["installer_business_id"] : null;
    if (!name || !biz) continue;
    const el: NotOnboardedElectrician = { installerBusinessId: biz, name, licence: typeof d["licence"] === "string" ? d["licence"] : null, email: typeof d["email"] === "string" ? d["email"].toLowerCase() : null };
    const key = electricianInviteKey(el);
    const cur = out.get(key);
    if (cur) { cur.jobIds.push(jobId); if (!cur.email && el.email) cur.email = el.email; }
    else out.set(key, { ...el, jobIds: [jobId], since: e.created_at });
  }
  return out;
}

export async function sweepRecOnboardingInvites(now = new Date()) {
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const pending = await pendingElectricians(since);
  const out = { checked: pending.size, sent: 0, skipped: {} as Record<string, number>, failed: 0 };
  if (!pending.size) return out;
  const { customerCommsEnabled } = await import("./comms.server");
  const commsEnabled = await customerCommsEnabled();
  const { data: issued, error: ie } = await admin.from("admin_config_events").select("details").eq("event_type", REC_ONBOARDING_INVITE_EVENT).in("details->>key", [...pending.keys()]);
  if (ie) throw new Error("Could not read earlier onboarding invites.");
  const issuedKeys = new Set((issued ?? []).map((r) => String((r.details as { key?: string } | null)?.key ?? "")));
  for (const [key, el] of pending) {
    // An open nomination by this installer for the same email or licence (job_id null) — the existing manual path's own record.
    let nomination: { id: string; business_id: string | null; status: string; invite_sent_at: string | null; invite_link_issued_at: string | null; contact_name: string } | null = null;
    let attempted = false;
    const lic = (el.licence ?? "").trim();
    if (el.email || lic) {
      let q = admin.from("electrician_nominations").select("id, business_id, status, invite_sent_at, invite_link_issued_at, contact_name").eq("nominating_business_id", el.installerBusinessId).is("job_id", null).is("ended_at", null);
      const ors = [el.email ? `email.ilike.${el.email.replace(/[%_,]/g, "")}` : null, lic ? `licence_number.ilike.${lic.replace(/[%_,]/g, "")}` : null].filter(Boolean).join(",");
      q = q.or(ors);
      const { data: n } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      nomination = n ?? null;
      if (nomination) {
        const { data: attempts } = await admin.from("admin_config_events").select("id").eq("event_type", "office_manual_email").contains("details", { nominationId: nomination.id, label: REC_ONBOARDING_INVITE_LABEL }).limit(1);
        attempted = !!attempts?.length;
      }
    }
    const decision = recInviteDecision({ electrician: el, commsEnabled, alreadyIssued: issuedKeys.has(key), existingNomination: nomination ? { ...nomination, attempted } : null });
    if (decision.action === "skip") {
      out.skipped[decision.reason] = (out.skipped[decision.reason] ?? 0) + 1;
      // Paused comms are retried next tick; every other skip is final for this key and recorded once so the office can see why.
      if (decision.reason !== "comms_paused" && decision.reason !== "already_issued")
        await admin.from("admin_config_events").insert({ actor_id: null, event_type: REC_ONBOARDING_INVITE_EVENT, summary: `REC onboarding invite not sent to ${el.name}: ${INVITE_SKIP_TEXT[decision.reason]}`, details: { key, status: "skipped", reason: decision.reason, electrician: el, job_ids: el.jobIds } });
      continue;
    }
    // Send through the existing manual path: a nomination row with a fresh token, then the one email (TEST → test inbox).
    try {
      const { newToken, hashToken } = await import("./worker-links.core");
      const invite = newToken();
      const { data: row, error } = await admin.from("electrician_nominations").insert({
        contact_name: el.name, email: el.email, licence_number: el.licence, phone: null, business_name: null,
        nominating_business_id: el.installerBusinessId, nominated_by: null, nominated_for: "installer", business_id: null,
        status: "invite_pending_comms", invite_link_issued_at: now.toISOString(), invite_token_hash: await hashToken(invite), invite_expires_at: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
      }).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "nomination not saved");
      const { sendElectricianInvite } = await import("./job-electrician-invite.server");
      const r = await sendElectricianInvite({ actorId: null, nominationId: row.id, installerBusinessId: el.installerBusinessId, inviteToken: invite, to: el.email!, name: el.name });
      await admin.from("admin_config_events").insert({ actor_id: null, event_type: REC_ONBOARDING_INVITE_EVENT, summary: `REC onboarding invite to ${el.name} (${r.to}): ${r.status}`, details: { key, status: r.status, detail: r.detail ?? null, test: r.test, nomination_id: row.id, electrician: el, job_ids: el.jobIds } });
      if (r.status === "sent") out.sent++; else out.failed++;
    } catch (e) {
      out.failed++;
      await admin.from("admin_config_events").insert({ actor_id: null, event_type: REC_ONBOARDING_INVITE_EVENT, summary: `REC onboarding invite to ${el.name} failed: ${(e as Error).message}`, details: { key, status: "failed", electrician: el, job_ids: el.jobIds } });
    }
  }
  return out;
}
