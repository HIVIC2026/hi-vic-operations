// Portal speed step 2, Task 6 (spec rule 4, "Sign-in opens the first screen in one go"): after the password is accepted
// the portal asks ONE server call for who this person is (their roles and whether a business is linked to their profile —
// the same two facts /portal read from the browser) AND the first screen's data, then shows that screen.
// Where they land is still decided by the unchanged pure rule `portalDestination` (set-password-link.core), on the
// client, from these facts; this module only reads. Every screen and server function still checks access itself.
//   - Installers / trade businesses (/field): My work's own answer (`tradeHome`, exactly as getTradeHome gives it).
//   - Office (/admin/needs-me): Needs me's saved copy, exactly as getNeedsMePage gives an office admin (never the TEST office).
// Both are started alongside the role read (one round, not one after another) and dropped when the rule sends the person
// elsewhere; a failed screen read is simply not handed over — the screen then asks for itself and shows its own message.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { portalDestination } from "./set-password-link.core";
import { early } from "./early-read";
import type { Json } from "@/integrations/supabase/types";

export type FirstScreen = {
  roles: string[];
  hasBusiness: boolean;
  /** My work's answer for `["trade-home"]` (null = this sign-in isn't linked, as getTradeHome says); absent = not handed over. */
  home?: { value: Json };
  /** Needs me's answer for `["needs-me-v2", false]`; absent = not handed over. */
  needs?: { value: Json };
};

export type FirstScreenDeps = {
  tradeHome: (userId: string) => Promise<unknown>;
  /** "admin" for an office admin, "qa_office" for the TEST office; throws for anyone else (requireOfficeIdentity). */
  officeIdentity: () => Promise<"admin" | "qa_office">;
  needsMe: () => Promise<unknown>;
};

/** The server-function return must be JSON-shaped (TanStack checks the type), so the handed-over answers are typed Json. */
const plain = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json;

export async function firstScreenAfterSignIn(userId: string, deps: FirstScreenDeps): Promise<FirstScreen> {
  const homeP = early(deps.tradeHome(userId).then((v) => ({ value: plain(v) }), (e: Error) => (/isn't linked/.test(String(e?.message)) ? { value: null } : null)));
  // Speed: the office check starts only once the person is known to be heading for the office (below). Started for
  // everyone it took request slots the trade home's own reads were waiting for (a worker keeps only a few open at once).
  const [{ data: roleRows, error: rolesError }, { data: profile, error: profileError }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("profiles").select("business_id").eq("id", userId).maybeSingle(),
  ]);
  if (rolesError || profileError) throw new Error("Could not read who you are.");
  const roles = (roleRows ?? []).map((r) => String(r.role));
  const hasBusiness = !!profile?.business_id;
  const to = portalDestination({ roles, hasBusiness });
  const out: FirstScreen = { roles, hasBusiness };
  if (to === "/field") {
    const home = await homeP;
    if (home) out.home = home;
  } else if (to === "/admin/needs-me" && (await deps.officeIdentity().catch(() => null)) === "admin") {
    const needs = await deps.needsMe().then((v) => ({ value: plain(v) }), () => null);
    if (needs) out.needs = needs;
  }
  return out;
}
