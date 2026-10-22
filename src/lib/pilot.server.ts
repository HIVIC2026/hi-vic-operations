// Persistence for the ReInsulate pilot (partner network). Rules live in pilot.core.ts.
import { createHash } from "crypto";
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { cobrandSnapshot, partnerWorkBlocker, type BusinessLike, type Credential } from "./pilot.core";

export const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

export async function loadBusiness(id: string) {
  const [{ data: b, error: businessError }, { data: creds, error: credentialsError }] = await Promise.all([
    admin.from("businesses").select("*").eq("id", id).maybeSingle(),
    admin.from("business_credentials").select("kind,label,expires_at,critical,verification,profile_id").eq("business_id", id),
  ]);
  if (businessError) throw new WorkflowError(`Could not read business approval: ${businessError.message}`);
  if (credentialsError) throw new WorkflowError(`Could not read business credentials: ${credentialsError.message}`);
  return { business: b, credentials: (creds ?? []) as Credential[] };
}

/** Businesses the user belongs to (profile link or membership), with their member role. */
export async function myBusinesses(userId: string) {
  const [{ data: p, error: profileError }, { data: m, error: membershipError }] = await Promise.all([
    admin.from("profiles").select("business_id").eq("id", userId).maybeSingle(),
    admin.from("business_members").select("business_id, member_role").eq("user_id", userId).eq("active", true),
  ]);
  if (profileError) throw new WorkflowError(`Could not read the business profile link: ${profileError.message}`);
  if (membershipError) throw new WorkflowError(`Could not read active business memberships: ${membershipError.message}`);
  const map = new Map<string, "business_admin" | "member">();
  if (p?.business_id) map.set(p.business_id, "member");
  for (const r of m ?? []) map.set(r.business_id, r.member_role === "business_admin" ? "business_admin" : (map.get(r.business_id) ?? "member"));
  return map;
}

export async function requireMember(userId: string, businessId: string, adminOnly = false) {
  const role = (await myBusinesses(userId)).get(businessId);
  if (!role || (adminOnly && role !== "business_admin")) throw new WorkflowError(adminOnly ? "Only your business admin can do this." : "You are not part of this business.");
  return role;
}

/** Throws unless the business may do compliance-critical work right now. */
export async function requireApprovedPartner(businessId: string) {
  const { business, credentials } = await loadBusiness(businessId);
  const b = partnerWorkBlocker(business as BusinessLike | null, credentials);
  if (b) throw new WorkflowError(b);
  return business!;
}

/** Automatic expiry sweep: approved businesses with an expired critical credential become 'expired'. */
export async function sweepPartnerExpiry(actorId: string | null) {
  const { data: rows } = await admin.from("businesses").select("id").eq("onboarding_status", "approved");
  let expired = 0;
  for (const r of rows ?? []) {
    const { business, credentials } = await loadBusiness(r.id);
    const blocker = partnerWorkBlocker(business as BusinessLike, credentials);
    if (blocker?.startsWith("Expired")) {
      await admin.from("businesses").update({ onboarding_status: "expired", onboarding_notes: (business as { onboarding_notes?: string | null }).onboarding_notes?.includes("[TEST PARTNER]") ? `[TEST PARTNER] ${blocker}` : blocker, updated_at: new Date().toISOString() }).eq("id", r.id);
      expired++;
    }
  }
  return { checked: rows?.length ?? 0, expired, actorId };
}

/** Stamp the partner co-branding on this job's issued installation quotes (customer-safe fields only). */
export async function applyCobrand(jobId: string) {
  const { data: j } = await admin.from("jobs").select("customer_relationship_owner").eq("id", jobId).single();
  const { data: a } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a?.business_id) return;
  const { data: b } = await admin.from("businesses").select("name, trading_name, abn, branding").eq("id", a.business_id).single();
  if (!b) return;
  const branding = (b.branding ?? {}) as { logo_url?: string };
  const cobrand = cobrandSnapshot({ partnerName: b.trading_name || b.name, partnerLogoUrl: branding.logo_url, partnerAbn: b.abn, relationshipOwner: (j?.customer_relationship_owner as "hivic" | "installer") ?? "hivic" });
  await admin.from("quotes").update({ partner_business_id: a.business_id, cobrand: cobrand as unknown as Json }).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued"]);
}

export async function logPartner(jobId: string | null, actorId: string, type: string, summary: string, details: Record<string, unknown> = {}) {
  if (jobId) await logEvent(jobId, actorId, type, summary, details);
}

/** Jobs created by TEST sign-ins or for TEST businesses are always saved as qa_test so they never touch live automation. */
export async function intakeSourceFor(userId: string, businessId: string | null, fallback: string): Promise<string> {
  const [{ data: u, error: ue }, { data: b, error: be }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    businessId ? admin.from("businesses").select("name, onboarding_notes").eq("id", businessId).maybeSingle() : Promise.resolve({ data: null as { name: string; onboarding_notes: string | null } | null, error: null }),
  ]);
  // Fail closed: an unreadable user/business must never silently stamp a TEST job as live.
  if (ue || !u?.user || be || (businessId && !b)) throw new Error("Could not confirm whether this job is TEST or live. Please retry.");
  const testUser = u?.user?.user_metadata?.["qa_test"] === true || /@hivic-test\.example$/i.test(u?.user?.email ?? "");
  const testBiz = /^TEST\b/i.test(b?.name ?? "") || (b?.onboarding_notes ?? "").includes("[TEST PARTNER]"); // TEST-partner mark, e.g. "[TEST PARTNER] Reinsulate"
  return testUser || testBiz ? "qa_test" : fallback;
}
