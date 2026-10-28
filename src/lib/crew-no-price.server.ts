// Jo 28 Oct 2026 (spec rule 3): "owner" means owner of the business on THIS job — not of some other business the
// person also belongs to (trade-view `tradeContext` takes the first active membership). Used wherever a trade read
// decides owner vs crew/staff for price-free output (crew-no-price.core). Reuses the ONE membership check that Save price
// and the switch to our electrician use (`requireJobBusinessOwner` / `requireMember(…, true)`); nothing is copied.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

const passes = (p: Promise<unknown>) => p.then(() => true, () => false);

/**
 * True only when the viewer is the business admin of every business they hold this job through for `role` (their own
 * active assignments), and — on an installer's own customer (A1) — of the job's originating installer business. A viewer
 * with no assignment of their own on the job is the owner only of that job's business: the originating business on
 * A1 (installer), else a business with an active `role` assignment on the job. Any failure = not the owner.
 */
export async function ownsJobBusiness(jobId: string, userId: string, role: "installer" | "electrician"): Promise<boolean> {
  const [{ data: rows, error }, { data: job }] = await Promise.all([
    admin.from("job_assignments").select("business_id, user_id").eq("job_id", jobId).eq("role", role).eq("active", true),
    admin.from("jobs").select("channel, originating_installer_business_id").eq("id", jobId).maybeSingle(),
  ]);
  if (error) return false;
  const { requireMember } = await import("./pilot.server");
  const ownerOf = (b: string) => passes(requireMember(userId, b, true));
  const a1 = role === "installer" && job?.channel === "installer_sourced" && !!job.originating_installer_business_id;
  const ownsA1 = () => passes((async () => (await import("./installer-price-set.server")).requireJobBusinessOwner(jobId, userId))());
  const mine = [...new Set((rows ?? []).filter((r) => r.user_id === userId && r.business_id).map((r) => r.business_id as string))];
  if (mine.length) {
    for (const b of mine) if (!(await ownerOf(b))) return false;
    return a1 ? ownsA1() : true;
  }
  if (a1) return ownsA1();
  for (const b of new Set((rows ?? []).map((r) => r.business_id).filter((b): b is string => !!b))) if (await ownerOf(b)) return true;
  return false;
}
