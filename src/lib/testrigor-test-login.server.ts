import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireQaAdmin, validateTestRigorIdentities } from "./qa-access.server";
import { issuePartnerLoginLink } from "./set-password-link.server";
import { hashToken } from "./worker-links.core";
import { TESTRIGOR_FILENAME, TESTRIGOR_PERSONAS, testRigorHandoverText, type TestRigorLink, type TestRigorPersona } from "./testrigor-test-login.core";

const UNVERIFIED = "The private testRigor TEST login file could not be verified. Nothing was downloaded.";

/** Decision 403. Same path as Deep's TEST login: admin only, fixed TEST identities, one-time 24h hashed set-password links. */
export async function issueTestRigorDownload(context: { supabase: SupabaseClient<Database>; userId: string }) {
  await requireQaAdmin(context);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  // Both identities are verified before any link is issued.
  const identities = await validateTestRigorIdentities(admin);
  const links = {} as Record<TestRigorPersona, TestRigorLink>;
  for (const { persona, email } of TESTRIGOR_PERSONAS) {
    if (identities[persona].email !== email) throw new Error(UNVERIFIED);
    const setup = new URL(await issuePartnerLoginLink(email, context.userId, null));
    setup.searchParams.set("next", "/portal");
    const token = setup.searchParams.get("link");
    if (!token) throw new Error(UNVERIFIED);
    const { data: row, error } = await admin.from("partner_login_links").select("email, created_by, application_id, expires_at, used_at")
      .eq("token_hash", await hashToken(token)).single();
    if (error || !row || row.email !== email || row.created_by !== context.userId || row.application_id !== null || row.used_at !== null || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) {
      throw new Error(UNVERIFIED);
    }
    links[persona] = { setupUrl: setup.toString(), expiresAt: row.expires_at };
  }
  return { filename: TESTRIGOR_FILENAME, mimeType: "text/plain;charset=utf-8", content: testRigorHandoverText(links) };
}
