/**
 * "Register my interest" server functions.
 *
 * The public submit writes through the publishable client so the anon INSERT policy
 * applies (one insert, nothing readable). Reading and working the list is admin-only.
 * Jo 27 Oct: each new registration then starts the normal website enquiry journey (calculator-intake.server).
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  INTEREST_STATUSES,
  parseInterest,
  type InterestDraft,
  type InterestStatus,
} from "./interest.core";

export type InterestErrors = Partial<Record<keyof InterestDraft | "submit", string>>;
export type InterestResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; errors: InterestErrors };

export type InterestRow = {
  id: string;
  created_at: string;
  full_name: string;
  mobile: string;
  email: string;
  address_line: string;
  suburb: string;
  postcode: string;
  ceiling_m2: number;
  insulation_declared: "none" | "present" | "unknown";
  consent_version: string;
  consented_at: string;
  status: string;
  admin_notes: string | null;
  followed_up_at: string | null;
  source: string;
};

async function requireAdmin(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) throw new Error("We could not check your access. Please sign in again.");
  if (!data) throw new Error("Home Insulation Victoria staff only.");
}

export const registerInterest = createServerFn({ method: "POST" })
  .inputValidator((input: InterestDraft) => input)
  .handler(async ({ data }): Promise<InterestResult> => {
    const parsed = parseInterest(data);
    if (!parsed.ok) return { ok: false, errors: parsed.errors as InterestErrors };
    // Each genuine registration reaches the normal OPEN-address matcher. A contact-only 24h
    // precheck hid repeat enquiries after closure and enquiries for another home.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("calculator_interests").insert({
      full_name: parsed.value.fullName,
      mobile: parsed.value.mobile,
      email: parsed.value.email,
      address_line: parsed.value.addressLine,
      suburb: parsed.value.suburb,
      postcode: parsed.value.postcode,
      ceiling_m2: parsed.value.ceilingM2,
      insulation_declared: parsed.value.insulationDeclared,
      consent_version: parsed.value.consentVersion,
    }).select("id, consented_at").single();
    if (error || !row)
      return {
        ok: false,
        errors: { submit: "We could not save your details just now. Please try again, or send an enquiry from our website." },
      };
    // The registration is saved; a failed enquiry start is recorded on the row for the office, never lost.
    try {
      const { startCalculatorEnquiry } = await import("./calculator-intake.server");
      await startCalculatorEnquiry(row.id, parsed.value, row.consented_at);
    } catch (e) {
      console.error("calculator enquiry start failed", e);
      await supabaseAdmin.from("calculator_interests").update({ intake_error: String((e as Error).message ?? e).slice(0, 500) }).eq("id", row.id);
    }
    return { ok: true, duplicate: false };
  });

export const listInterests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InterestRow[]> => {
    await requireAdmin(context.supabase);
    const { data, error } = await context.supabase
      .from("calculator_interests")
      .select(
        "id, created_at, full_name, mobile, email, address_line, suburb, postcode, ceiling_m2, insulation_declared, consent_version, consented_at, status, admin_notes, followed_up_at, source",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error("We could not load the interest list. Please try again.");
    return (data ?? []) as unknown as InterestRow[];
  });

export const updateInterest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status?: InterestStatus; notes?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.status && !INTEREST_STATUSES.includes(data.status)) throw new Error("That status is not available.");
    const patch: {
      status?: InterestStatus;
      followed_up_by?: string;
      followed_up_at?: string;
      admin_notes?: string;
    } = {};
    if (data.status) {
      patch.status = data.status;
      patch.followed_up_by = context.userId;
      patch.followed_up_at = new Date().toISOString();
    }
    if (typeof data.notes === "string") patch.admin_notes = data.notes.slice(0, 2000);
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await context.supabase.from("calculator_interests").update(patch).eq("id", data.id);
    if (error) throw new Error("We could not save that change. Please try again.");
    return { ok: true };
  });

/** Admin-only, read-only: what the existing unlinked registrations would do (counts only). Writes nothing. */
export const dryRunCalculatorInterests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { dryRunCalculatorBackfill } = await import("./calculator-intake.server");
    return dryRunCalculatorBackfill();
  });
