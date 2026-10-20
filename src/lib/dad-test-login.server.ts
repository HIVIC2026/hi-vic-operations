import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireQaAdmin, validateDadTestIdentity } from "./qa-access.server";
import { issuePartnerLoginLink } from "./set-password-link.server";
import { hashToken } from "./worker-links.core";
import { dadTestHandoverText } from "./dad-test-login.core";

export async function issueDadTestDownload(context: { supabase: SupabaseClient<Database>; userId: string }) {
  await requireQaAdmin(context);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const identity = await validateDadTestIdentity(admin);
  const setup = new URL(await issuePartnerLoginLink(identity.email, context.userId, null));
  setup.searchParams.set("next", "/portal");
  const token = setup.searchParams.get("link");
  if (!token) throw new Error("The private TEST login file could not be prepared.");
  const { data: row, error } = await admin.from("partner_login_links").select("email, created_by, application_id, expires_at, used_at")
    .eq("token_hash", await hashToken(token)).single();
  if (error || !row || row.email !== identity.email || row.created_by !== context.userId || row.application_id !== null || row.used_at !== null || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) {
    throw new Error("The private TEST login file could not be verified. Nothing was downloaded.");
  }
  return { filename: "Dad-TEST-installer-login.txt", mimeType: "text/plain;charset=utf-8", content: dadTestHandoverText(setup.toString(), row.expires_at) };
}