import { exactLike } from "./email-match";

/** Neutral wording: a database failure never names another customer or business. */
export const OWNER_SAVE_FAILED = "The customer could not be saved. Please contact the office for help; your entered details are kept.";

/**
 * Decision 282 (Jo 25 Oct 2026): one email may sit on any number of owners and jobs, so every installer job gets its
 * OWN owner row — nothing is matched or refused on email. No global owner merge, no update of anyone else's record.
 *
 * Until `docs/pending-migrations/owners-email-not-unique.sql` is applied the live `owners_email_uq` index still
 * refuses a second row with the same email; in that case the only recovery is the installer's own earlier customer
 * (an installer-sourced job of the same business carrying that email), otherwise the neutral save error.
 */
export async function createInstallerOwner(db: any, businessId: string, input: { full_name: string; email: string | null; phone: string | null }): Promise<{ id: string }> {
  const email = input.email?.trim().toLowerCase() || null;
  const { data, error } = await db.from("owners").insert({ ...input, email }).select("id").single();
  if (!error && data) return data;
  if (error?.code !== "23505" || !email) throw new Error(OWNER_SAVE_FAILED);
  const found = await db.from("jobs").select("owner_id, owners!inner(email)").eq("channel", "installer_sourced").eq("originating_installer_business_id", businessId).ilike("owners.email", exactLike(email)).limit(1).maybeSingle();
  if (found.error) throw new Error("We couldn't check this customer's existing job. Please try again.");
  if (found.data?.owner_id) return { id: found.data.owner_id };
  throw new Error(OWNER_SAVE_FAILED);
}
