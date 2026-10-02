// Mitti membership recording. Mitti can only hand a form to someone who is already a member of
// the Home Insulation Victoria Mitti organisation, so the portal verifies and stores who is in.
// The network call is realMittiCall (the only Mitti boundary); the rule itself is pure (mitti-membership.core.ts).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { mittiApi, pickUser, type MittiCall } from "./mitti.core";
import { realMittiCall } from "./mitti.server";
import { mittiAccessOf, type MittiAccess, type MittiMemberRow } from "./mitti-membership.core";

const MEMBER_COLUMNS = "id, full_name, email, mitti_user_id, mitti_checked_email, mitti_checked_at";

export type MemberRow = { id: string; full_name: string | null } & MittiMemberRow;

export async function loadMember(userId: string): Promise<MemberRow> {
  const { data, error } = await admin.from("profiles").select(MEMBER_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw new WorkflowError(`This person's record could not be read: ${error.message}`);
  if (!data) throw new WorkflowError("This person is not a portal user yet – ask them to sign up once with their Mitti email.");
  return data as unknown as MemberRow;
}

/** Ask Mitti whether this email is a member of our organisation, then store exactly what was found. */
export async function verifyMittiMember(userId: string, actorId: string, call: MittiCall = realMittiCall) {
  const row = await loadMember(userId);
  const email = String(row.email ?? "").trim();
  if (!email) throw new WorkflowError("This person has no email address on file, so Mitti access cannot be checked. Add their email first.");
  // A failed lookup leaves the previous record untouched: Mitti being unreachable is not proof someone left.
  const found = pickUser(await mittiApi(call).searchUsers(email), email);
  const rawId = found?.id ?? found?.user_id;
  const mittiUserId = rawId == null || rawId === "" ? null : String(rawId);
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("profiles")
    .update({ mitti_user_id: mittiUserId, mitti_checked_email: email, mitti_checked_at: checkedAt })
    .eq("id", userId);
  if (error) throw new WorkflowError(`Mitti answered, but the result could not be saved: ${error.message}`);
  void actorId;
  return {
    userId,
    email,
    fullName: row.full_name,
    access: mittiAccessOf({ email, mitti_user_id: mittiUserId, mitti_checked_email: email, mitti_checked_at: checkedAt }) as MittiAccess,
    checkedAt,
  };
}

/** The assignment guard: an electrician/installer may only be given a job once Mitti confirms them. */
export async function requireMittiAccess(userId: string, role: "electrician" | "installer") {
  const row = await loadMember(userId);
  return { row, access: mittiAccessOf(row) as MittiAccess };
}

/** Onboarding sweep: check every electrician/installer role holder, one Mitti call each. */
export async function checkAllTradeMittiAccess(limit = 40) {
  const { data: roles, error } = await admin.from("user_roles").select("user_id").in("role", ["electrician", "installer"]);
  if (error) throw new WorkflowError(`Trade role holders could not be listed: ${error.message}`);
  const ids = [...new Set((roles ?? []).map((r) => r.user_id))];
  const toCheck = ids.slice(0, Math.max(1, Math.min(limit, 60)));
  const results: { userId: string; email: string | null; access: MittiAccess; error?: string }[] = [];
  for (const userId of toCheck) {
    try {
      const r = await verifyMittiMember(userId, "onboarding_sweep");
      results.push({ userId, email: r.email, access: r.access });
    } catch (e) {
      const { data: p } = await admin.from("profiles").select("email").eq("id", userId).maybeSingle();
      results.push({ userId, email: (p as { email: string | null } | null)?.email ?? null, access: "unchecked", error: e instanceof Error ? e.message : "Mitti check failed" });
    }
  }
  return { checked: results.length, remaining: Math.max(0, ids.length - toCheck.length), results };
}
