import { exactLike } from "./email-match";

/** No global owner merge: reuse only a customer already linked to this originating installer. */
export async function createInstallerOwner(db: any, businessId: string, input: { full_name: string; email: string | null; phone: string | null }): Promise<{ id: string }> {
  const email = input.email?.trim().toLowerCase() || null;
  const { data, error } = await db.from("owners").insert({ ...input, email }).select("id").single();
  if (!error && data) return data;
  if (error?.code !== "23505" || !email) throw new Error("The customer could not be saved. Please try again.");
  const found = await db.from("jobs").select("owner_id, owners!inner(email)").eq("channel", "installer_sourced").eq("originating_installer_business_id", businessId).ilike("owners.email", exactLike(email)).limit(1).maybeSingle();
  if (found.error) throw new Error("We couldn't check this customer's existing job. Please try again.");
  if (found.data?.owner_id) return { id: found.data.owner_id };
  throw new Error("This email is already on a customer who isn't yours (one of our leads, or another installer's customer). Check the email with the owner. If it's right, the office needs to confirm the customer is yours before the job can be added. Your details are still here.");
}