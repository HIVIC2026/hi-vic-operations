import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, requireJobRole } from "./workflow.server";

const uuid = z.string().uuid();

async function adminClient() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export const getAdminPartnerEnquiries = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const admin = await adminClient();
  const { data, error } = await admin.from("partner_enquiries").select("*").or("source.is.null,source.not.in.(portal_rec_onboarding_test,portal_installer_onboarding_test)").order("created_at", { ascending: false });
  if (error) throw new Error(`Partner enquiries could not be loaded: ${error.message}`);
  return data ?? [];
});

export const getJobOverview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "owner", "electrician", "installer"]);
    const admin = await adminClient();
    const { data: row, error } = await admin.from("job_overview").select("*").eq("id", data.jobId).maybeSingle();
    if (error) throw new Error(`Job could not be loaded: ${error.message}`);
    if (!row) throw new Error("Job not found or no longer available.");
    return row;
  });

export const getAdminBusinesses = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const admin = await adminClient();
  const { data, error } = await admin.from("businesses").select("id, name, business_type, capabilities, onboarding_status, xero_contact_status, updated_at").order("name");
  if (error) throw new Error(`Partner businesses could not be loaded: ${error.message}`);
  return data ?? [];
});

export const getAdminUsers = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const admin = await adminClient();
  const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }, { data: businesses, error: businessesError }] = await Promise.all([
    admin.from("profiles").select("*").order("created_at"),
    admin.from("user_roles").select("*"),
    admin.from("businesses").select("id,name,business_type").order("name"),
  ]);
  const error = profilesError ?? rolesError ?? businessesError;
  if (error) throw new Error(`Users could not be loaded: ${error.message}`);
  return { profiles: profiles ?? [], roles: roles ?? [], businesses: businesses ?? [] };
});

export const getAdminJobEligibility = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const admin = await adminClient();
    const { data: row, error } = await admin.from("jobs").select("*, properties(*)").eq("id", data.jobId).single();
    if (error) throw new Error(`Eligibility details could not be loaded: ${error.message}`);
    return row;
  });

export const getAdminAssignments = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const admin = await adminClient();
    const [{ data: assignments, error: assignmentsError }, { data: roles, error: rolesError }, { data: requests, error: requestsError }] = await Promise.all([
      admin.from("job_assignments").select("*, profiles!job_assignments_user_id_fkey(full_name)").eq("job_id", data.jobId).order("assigned_at", { ascending: false }),
      admin.from("user_roles").select("user_id, role, profiles(full_name, email, mitti_user_id, mitti_checked_email, mitti_checked_at)").in("role", ["electrician", "installer"]),
      admin.from("reassignment_requests").select("*").eq("job_id", data.jobId).eq("status", "open"),
    ]);
    const error = assignmentsError ?? rolesError ?? requestsError;
    if (error) throw new Error(`Assignments could not be loaded: ${error.message}`);
    return { a: assignments ?? [], roles: roles ?? [], rr: requests ?? [] };
  });