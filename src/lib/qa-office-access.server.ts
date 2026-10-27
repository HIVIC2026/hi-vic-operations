// Separate TEST-office capability. Never widen requireAdmin or infer authority from user metadata.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { qaOfficeIdentityBlocker, qaOfficeJobBlocker, qaOfficeReservedEmail, type QaOfficeBusiness } from "./qa-office.core";
import { requireAdmin } from "./workflow.server";

type Client = SupabaseClient<Database>;
type Row = Record<string, unknown>;
const text = (value: unknown): string | null => typeof value === "string" ? value : null;

/** Lists choose their scope on the server; a browser includeTest flag is never authorization. */
export async function requireOfficeIdentity(sb: Client): Promise<"admin" | "qa_office"> {
  const { data: auth, error } = await sb.auth.getUser();
  if (error || !auth.user) throw new Error("Office sign-in required.");
  const { data: rows, error: roleError } = await sb.from("user_roles").select("role").eq("user_id", auth.user.id);
  if (roleError) throw new Error("Office permissions could not be checked.");
  const roles = (rows ?? []).map(row => String(row.role));
  if (!roles.includes("qa_office")) { await requireAdmin(sb); return "admin"; }
  const blocked = qaOfficeIdentityBlocker({ roles, email: auth.user.email ?? null, emailVerified: !!auth.user.email_confirmed_at });
  if (blocked) throw new Error(blocked);
  return "qa_office";
}

export async function officeTestJobIds(sb: Client): Promise<string[]> {
  if (await requireOfficeIdentity(sb) !== "qa_office") throw new Error("Dedicated TEST office required.");
  const ids: string[] = [];
  for (let offset = 0; ; offset += 100) {
    // RLS scopes the candidate list before data leaves the database; graph recheck protects privileged readers.
    const { data, error } = await sb.from("jobs").select("id").eq("source", "qa_test").is("deleted_at", null).is("qa_archived_at", null).order("id").range(offset, offset + 99);
    if (error) throw new Error("TEST job scope could not be checked.");
    for (const row of data ?? []) { await requireOfficeJob(sb, row.id); ids.push(row.id); }
    if (!data || data.length < 100) return ids;
  }
}

export async function requireOfficeBusiness(sb: Client, businessId: string): Promise<void> {
  if (await requireOfficeIdentity(sb) === "admin") return;
  const { data, error } = await (sb as unknown as SupabaseClient).rpc("qa_office_business_allowed", { _business: businessId });
  if (error || data !== true) throw new Error("Only fully isolated TEST businesses are available to TEST office.");
}

export async function officeTestBusinessIds(sb: Client): Promise<string[]> {
  if (await requireOfficeIdentity(sb) !== "qa_office") throw new Error("Dedicated TEST office required.");
  // No privileged candidate scan: RLS filters the list first.
  const { data, error } = await sb.from("businesses").select("id").ilike("email", "%@hivic-test.example").like("onboarding_notes", "%[TEST PARTNER]%");
  if (error) throw new Error("TEST businesses could not be checked.");
  for (const row of data ?? []) await requireOfficeBusiness(sb, row.id);
  return (data ?? []).map(row => row.id);
}

export async function requireOfficeJob(sb: Client, jobId: string): Promise<"admin" | "qa_office"> {
  const { data: auth, error: authError } = await sb.auth.getUser();
  if (authError || !auth.user) throw new Error("Office sign-in required.");
  const { data: roleRows, error: roleError } = await sb.from("user_roles").select("role").eq("user_id", auth.user.id);
  if (roleError) throw new Error("Office permissions could not be checked.");
  const roles = (roleRows ?? []).map(row => String(row.role));
  if (!roles.includes("qa_office")) {
    await requireAdmin(sb);
    return "admin";
  }
  const identity = { roles, email: auth.user.email ?? null, emailVerified: !!auth.user.email_confirmed_at };
  const identityBlock = qaOfficeIdentityBlocker(identity);
  if (identityBlock) throw new Error(identityBlock);
  // RLS must authorize the graph before privileged helpers can run. An unapplied policy is a loud refusal.
  const { data: allowed, error: scopeError } = await (sb as unknown as SupabaseClient).rpc("qa_office_job_allowed", { _job: jobId });
  if (scopeError || allowed !== true) throw new Error("Only fully isolated TEST jobs are available to TEST office.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: job, error: jobError } = await supabaseAdmin.from("jobs")
    .select("source,deleted_at,qa_archived_at,owner_id,property_id,originating_installer_business_id,originating_installer_user_id").eq("id", jobId).maybeSingle();
  if (jobError || !job) throw new Error("Only fully isolated TEST jobs are available to TEST office.");
  const [owner, property, assignments, offers, bookings] = await Promise.all([
    supabaseAdmin.from("owners").select("email,user_id").eq("id", job.owner_id).maybeSingle(),
    supabaseAdmin.from("properties").select("owner_id,managed_by_business_id").eq("id", job.property_id).maybeSingle(),
    supabaseAdmin.from("job_assignments").select("business_id,user_id").eq("job_id", jobId),
    supabaseAdmin.from("partner_offers").select("business_id").eq("job_id", jobId),
    supabaseAdmin.from("bookings").select("business_id,contractor_id").eq("job_id", jobId),
  ]);
  if ([owner, property, assignments, offers, bookings].some(result => result.error) || !owner.data || !property.data || property.data.owner_id !== job.owner_id) {
    throw new Error("The TEST job's related records could not be checked.");
  }
  const businessIds = [...new Set([
    job.originating_installer_business_id, property.data.managed_by_business_id,
    ...(assignments.data ?? []).map(row => row.business_id), ...(offers.data ?? []).map(row => row.business_id),
    ...(bookings.data ?? []).map(row => row.business_id),
  ].filter((id): id is string => !!id))];
  const peopleIds = [...new Set([
    job.originating_installer_user_id, owner.data.user_id,
    ...(assignments.data ?? []).map(row => row.user_id), ...(bookings.data ?? []).map(row => row.contractor_id),
  ].filter((id): id is string => !!id))];
  const [businesses, workers, members, profiles] = await Promise.all([
    businessIds.length ? supabaseAdmin.from("businesses").select("id,email,onboarding_notes,signer_email,contact_people").in("id", businessIds) : { data: [], error: null },
    businessIds.length ? supabaseAdmin.from("partner_workers").select("email,profile_id").in("business_id", businessIds) : { data: [], error: null },
    businessIds.length ? supabaseAdmin.from("business_members").select("user_id,profiles!business_members_user_id_fkey(email)").in("business_id", businessIds) : { data: [], error: null },
    peopleIds.length ? supabaseAdmin.from("profiles").select("id,email").in("id", peopleIds) : { data: [], error: null },
  ]);
  if ([businesses, workers, members, profiles].some(result => result.error) || (businesses.data ?? []).length !== businessIds.length || (profiles.data ?? []).length !== peopleIds.length) {
    throw new Error("The TEST job's people and businesses could not be checked.");
  }
  const peopleEmails: (string | null)[] = [
    ...(profiles.data ?? []).map(row => row.email), ...(workers.data ?? []).map(row => row.email),
    ...(members.data ?? []).map(row => (row.profiles as { email?: string | null } | null)?.email ?? null),
  ];
  for (const business of businesses.data ?? []) {
    if (business.signer_email && !qaOfficeReservedEmail(business.signer_email)) throw new Error("The job contains a non-TEST business signer.");
    if (business.contact_people != null) {
      if (!Array.isArray(business.contact_people)) throw new Error("The TEST business contacts could not be checked.");
      for (const contact of business.contact_people) {
        if (!contact || typeof contact !== "object" || Array.isArray(contact)) throw new Error("The TEST business contacts could not be checked.");
        peopleEmails.push(text((contact as Row)["email"]));
      }
    }
  }
  const block = qaOfficeJobBlocker(identity, {
    source: job.source, deletedAt: job.deleted_at, archivedAt: job.qa_archived_at,
    ownerEmail: owner.data.email, peopleEmails, businesses: (businesses.data ?? []) as QaOfficeBusiness[],
  });
  if (block) throw new Error(block);
  return "qa_office";
}