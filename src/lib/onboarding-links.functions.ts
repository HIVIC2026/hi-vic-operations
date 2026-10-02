// Staff-issued onboarding links (QA test or office recovery). Admin only; the raw token is shown once
// and only its SHA-256 is stored. Requires staged migration 0079.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { AUTH_TOKEN_TTL_HOURS, newResumeToken } from "./onboarding-security.core";

export const issueOnboardingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    trade: z.enum(["rec", "installer"]),
    purpose: z.enum(["qa_test", "office_recovery"]),
    allow_incomplete_sign: z.boolean(),
    note: z.string().trim().min(3).max(300),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sha256Hex } = await import("./onboarding-security.server");
    const token = newResumeToken();
    const expires = new Date(Date.now() + AUTH_TOKEN_TTL_HOURS * 3_600_000).toISOString();
    const db = supabaseAdmin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await db.from("onboarding_authorisations").insert({
      token_hash: await sha256Hex(token), trade: data.trade, purpose: data.purpose,
      allow_incomplete_sign: data.purpose === "qa_test" && data.allow_incomplete_sign,
      max_uses: 1, expires_at: expires, issued_by: context.userId, note: data.note,
    }).select("id").single();
    if (error || !row) throw new Error("Could not create the link. The onboarding security update may not be installed yet.");
    await db.from("onboarding_authorisation_events").insert({ authorisation_id: row.id, event: "issued", actor: context.userId });
    const path = data.trade === "rec" ? "/electrician-onboarding" : "/installer-onboarding";
    return { id: row.id as string, path: `${path}?staff=${token}`, expires_at: expires };
  });

// Revokes an UNUSED link. Atomic in the database: a link already used or revoked is refused.
export const revokeOnboardingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
    const { data: ok, error } = await db.rpc("revoke_onboarding_authorisation", { _id: data.id, _actor: context.userId });
    if (error) throw new Error("Could not revoke the link.");
    if (ok !== true) throw new Error("This link has already been used or revoked.");
    return { ok: true };
  });

export type OnboardingLinkRow = { id: string; trade: "rec" | "installer"; purpose: "qa_test" | "office_recovery"; note: string | null; created_at: string; expires_at: string; uses: number; revoked_at: string | null; state: "unused" | "used" | "revoked" | "expired" };

// Lists recent links (no tokens) and first records an audit event for any that expired unused.
export const listOnboardingLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingLinkRow[]> => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any; rpc: (f: string) => PromiseLike<{ error: unknown }> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    await db.rpc("record_expired_onboarding_authorisations");
    const { data, error } = await db.from("onboarding_authorisations").select("id, trade, purpose, note, created_at, expires_at, uses, revoked_at").order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error("Could not load staff links. The onboarding security update may not be installed yet.");
    const now = Date.now();
    return (data ?? []).map((r: Omit<OnboardingLinkRow, "state">) => ({ ...r, state: r.revoked_at ? "revoked" : r.uses > 0 ? "used" : Date.parse(r.expires_at) <= now ? "expired" : "unused" }));
  });

type AdminDb = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type StartBlockRow = { key: string; key_label: string; trade: "rec" | "installer"; kind: "visitor" | "network"; recent_15m: number; recent_24h: number; refused: number; last_attempt: string; blocked: boolean };

// Lists current start-limit records by hashed key only (never IP, cookie, email or mobile).
export const listOnboardingStartBlocks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StartBlockRow[]> => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as unknown as AdminDb).rpc("list_onboarding_start_blocks");
    if (error) throw new Error("Could not load start limits. The onboarding security update may not be installed yet.");
    return ((data ?? []) as Array<Omit<StartBlockRow, "key" | "key_label"> & { fingerprint_hash: string }>).map(({ fingerprint_hash, ...r }) => ({
      ...r, key: fingerprint_hash, key_label: `${r.kind === "visitor" ? "Browser" : "Network"} …${fingerprint_hash.slice(-8)}`,
    }));
  });

// Clears ONE hashed limit record for ONE trade. Reason required; actor comes from the session, never the client.
export const clearOnboardingStartBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    trade: z.enum(["rec", "installer"]),
    kind: z.enum(["visitor", "network"]),
    reason: z.string().trim().min(3, "Enter a reason").max(300),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await (supabaseAdmin as unknown as AdminDb).rpc("clear_onboarding_start_block", {
      _fp: data.key, _trade: data.trade, _kind: data.kind, _actor: context.userId, _reason: data.reason,
    });
    if (error || id == null) throw new Error("This limit could not be cleared. It may have already expired or been cleared.");
    return { clearance_id: Number(id) };
  });

// Runs abandoned-upload cleanup now and returns counts only.
export const runOnboardingUploadCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { cleanupQuarantine } = await import("./onboarding-security.server");
    return cleanupQuarantine(supabaseAdmin as never, "office", { actor: context.userId, limit: 200 });
  });
