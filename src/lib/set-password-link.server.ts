// One way to issue a set-password link. generateLink never emails; we build our own link to /reset-password.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { SET_PASSWORD_BASE, setPasswordLink, partnerLoginUrl, type PartnerLinkOutcome } from "./set-password-link.core";
import { hashToken, newToken } from "./worker-links.core";

export async function issueSetPasswordLink(email: string, base = SET_PASSWORD_BASE): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data.properties?.hashed_token) throw new WorkflowError(`The set-password link failed: ${error?.message ?? "no token"}`);
  return setPasswordLink(data.properties.hashed_token, "/field/welcome", base);
}

/** 24-hour single-use partner login link (our token; the built-in reset token only lasts 1 hour). */
export async function issuePartnerLoginLink(email: string, actorId: string | null, applicationId: string | null, base = SET_PASSWORD_BASE): Promise<string> {
  const token = newToken();
  const { error } = await admin.from("partner_login_links").insert({ token_hash: await hashToken(token), email, created_by: actorId, application_id: applicationId });
  if (error) throw new WorkflowError(`The login link failed: ${error.message}`);
  return partnerLoginUrl(token, base);
}
/** Opening the link: claims it once (database-enforced), then mints a fresh one-time set-password token. */
export async function redeemPartnerLoginLink(token: string): Promise<{ outcome: PartnerLinkOutcome; tokenHash?: string }> {
  const { data, error } = await admin.rpc("claim_partner_login_link", { _token_hash: await hashToken(token) });
  const row = (data as { email: string | null; outcome: PartnerLinkOutcome }[] | null)?.[0];
  if (error || !row) return { outcome: "invalid" };
  if (row.outcome !== "ok" || !row.email) return { outcome: row.outcome };
  const { data: g, error: ge } = await admin.auth.admin.generateLink({ type: "recovery", email: row.email });
  if (ge || !g.properties?.hashed_token) return { outcome: "invalid" };
  return { outcome: "ok", tokenHash: g.properties.hashed_token };
}
