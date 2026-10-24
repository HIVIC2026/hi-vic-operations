// Step 3 preparation + secure no-login link persistence. Service role only. Never sends anything; never writes Gate 1.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { customerView, refreshIndicativeEstimate } from "./estimate.server";
import { logEvent } from "./workflow.server";
import { customerCommsEnabled, hasCurrentOwnerContactConsent } from "./comms.server";
import { LINK_PURPOSE, deliveryState, expiryFrom, isWellFormedToken, linkAllowed, linkUsable, newToken, planLink, publicPayload } from "./estimatelink.core";
import { formatPropertyAddress } from "./address";

async function activeLink(jobId: string) {
  const { data } = await admin.from("customer_estimate_links").select("id, status, expires_at, current_estimate_id").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  return data ?? null;
}

async function revokeActive(jobId: string, reason: string) {
  await admin.from("customer_estimate_links").update({ status: "revoked", revoked_at: new Date().toISOString(), revocation_reason: reason }).eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active");
}

/** Called after every official Gate 1 decision (worker + admin setEligibility). Idempotent. */
export async function syncStep3(jobId: string, actorId: string | null = null) {
  const view = await refreshIndicativeEstimate(jobId);
  const allowed = linkAllowed(view.mode);
  const cur = await activeLink(jobId);
  const plan = planLink(cur, allowed);
  const estimateId = view.estimate?.id ?? null;
  if (plan.action === "revoke") {
    await revokeActive(jobId, `Gate 1 no longer permits a customer estimate (${view.mode})`);
    await logEvent(jobId, actorId, "step3_link_revoked", "Step 3 estimate link revoked – Gate 1 does not permit a customer estimate", { mode: view.mode }, { internal: true });
    return { status: "revoked" as const, mode: view.mode };
  }
  if (plan.action === "none") return { status: "none" as const, mode: view.mode };
  if (plan.action === "issue") {
    if (plan.expire?.length) await admin.from("customer_estimate_links").update({ status: "expired" }).in("id", plan.expire);
    const { data: j } = await admin.from("jobs").select("owner_id").eq("id", jobId).single();
    if (!j?.owner_id) throw new Error("Job has no owner – cannot prepare estimate link");
    const { error } = await admin.from("customer_estimate_links").insert({ job_id: jobId, owner_id: j.owner_id, purpose: LINK_PURPOSE, token: newToken(), expires_at: expiryFrom(), current_estimate_id: estimateId });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    await logEvent(jobId, actorId, "step3_prepared", "Step 3 indicative estimate prepared – secure customer link ready (not sent)", { estimate_id: estimateId, measure_required: view.measureRequired }, { internal: true });
    return { status: "issued" as const, mode: view.mode };
  }
  if (cur && cur.current_estimate_id !== estimateId) {
    await admin.from("customer_estimate_links").update({ current_estimate_id: estimateId }).eq("id", cur.id);
    await logEvent(jobId, actorId, "step3_prepared", "Step 3 indicative estimate updated – secure customer link shows latest (not sent)", { estimate_id: estimateId }, { internal: true });
  }
  return { status: "reused" as const, mode: view.mode };
}

/** Public, no-login resolver. Generic failure for anything invalid. Re-evaluates current Gate 1 on every view. */
export async function resolvePublicEstimate(token: unknown, assessmentTestMode = false) {
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at, view_count").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return null;
  { const { jobDeletedBlocker } = await import("./job-live.server"); if (await jobDeletedBlocker(l.job_id)) return null; }
  const view = await refreshIndicativeEstimate(l.job_id);
  if (!linkAllowed(view.mode)) { await revokeActive(l.job_id, `Gate 1 no longer permits a customer estimate (${view.mode})`); return null; }
  const cv = customerView(view);
  if (!cv.visible) return null;
  await admin.from("customer_estimate_links").update({ view_count: (l.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq("id", l.id);
  const { recordEstimateView } = await import("./engagement.server");
  await recordEstimateView(l.job_id, l.id).catch(() => {});
  const { data: j } = await admin.from("jobs").select("job_number, properties(address_line, suburb, state, postcode)").eq("id", l.job_id).single();
  const p = j?.properties as { address_line: string | null; suburb: string | null; state: string | null; postcode: string | null } | null;
  const { referralUrlForJob } = await import("./referral.server");
  const referral = await referralUrlForJob(l.job_id).catch(() => null);
  const { readyCheckAcceptanceState } = await import("./readycheck-payment.server");
  const assessment = await readyCheckAcceptanceState(token).catch(() => null);
  const { readyCheckBookingAccess } = await import('./ready-check-booking-access.server');
  const [booking, saved] = await Promise.all([
    readyCheckBookingAccess(l.job_id),
    admin.from('lead_campaign_responses').select('spot_saved_at, opted_out_at').eq('job_id', l.job_id).maybeSingle(),
  ]);
  return { ...publicPayload({ job_number: j?.job_number ?? null, address: formatPropertyAddress(p) || null }, cv, referral, assessment), assessmentTestMode,
    bookingAllowed: booking.allowed, spotHeld: !!assessment || (!saved.error && !!saved.data?.spot_saved_at && !saved.data.opted_out_at) };
}

export async function estimateDeliveryReady(jobId: string) {
  const l = await activeLink(jobId);
  const active = linkUsable(l);
  const [consent, commsEnabled] = await Promise.all([hasCurrentOwnerContactConsent(jobId), customerCommsEnabled()]);
  const state = deliveryState({ activeLink: active, consent, commsEnabled });
  return { ready: state === "ready", state, consent, commsEnabled };
}

/** Admin status WITHOUT the token. */
export async function adminLinkStatus(jobId: string) {
  const { data } = await admin.from("customer_estimate_links").select("status, created_at, expires_at, revoked_at, revocation_reason, last_viewed_at, view_count").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { link: data ?? null, delivery: await estimateDeliveryReady(jobId) };
}

/** Admin-authorized only: returns the path containing the token. */
export async function adminLinkPath(jobId: string) {
  const { data } = await admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  return data && linkUsable(data) ? `/estimate/${data.token}` : null;
}

/** Jo 24 Oct: every owner whose quote goes out needs their secure My job link. Uses the Step 3 link when Gate 1 allows
 *  one; an installer's own job (e.g. bulk upload, no website Gate 1) gets a plain My job link. Never sends anything. */
export async function ensureOwnerLink(jobId: string): Promise<boolean> {
  const usable = async () => { const { data } = await admin.from("customer_estimate_links").select("status, expires_at").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle(); return !!data && linkUsable(data); };
  if (await usable()) return true;
  try { await syncStep3(jobId, null); } catch { /* fall through */ }
  if (await usable()) return true;
  const { data: j } = await admin.from("jobs").select("owner_id, channel").eq("id", jobId).single();
  if (!j?.owner_id || j.channel !== "installer_sourced") return false;
  await admin.from("customer_estimate_links").update({ status: "expired" }).eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active");
  const { error } = await admin.from("customer_estimate_links").insert({ job_id: jobId, owner_id: j.owner_id, purpose: LINK_PURPOSE, token: newToken(), expires_at: expiryFrom(), current_estimate_id: null });
  if (error && !/duplicate/i.test(error.message)) return false;
  await logEvent(jobId, null, "owner_link_prepared", "Secure My job link prepared for the owner's quote (not sent)", {}, { internal: true });
  return usable();
}
