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
  const { data, error } = await admin.from("partner_enquiries").select("*").neq("enquiry_type", "property_manager").order("created_at", { ascending: false });
  if (error) throw new Error(`Partner enquiries could not be loaded: ${error.message}`);
  // Office test marks (Jo / Chris practice runs) and QA applications are flagged so they never count as real.
  const { data: marks, error: mErr } = await admin.from("onboarding_test_marks").select("application_id");
  if (mErr) throw new Error(`Partner enquiries could not be loaded: ${mErr.message}`);
  const { data: apps, error: aErr } = await admin.from("rec_onboarding_applications").select("id, partner_enquiry_id, test_mode").not("partner_enquiry_id", "is", null);
  if (aErr) throw new Error(`Partner enquiries could not be loaded: ${aErr.message}`);
  const marked = new Set((marks ?? []).map((m) => m.application_id));
  const testEnquiries = new Set((apps ?? []).filter((a) => a.test_mode || marked.has(a.id)).map((a) => a.partner_enquiry_id));
  return (data ?? []).map((r) => ({ ...r, is_test: testEnquiries.has(r.id) || (r.source ?? "").endsWith("_test") }));
});

export const getJobOverview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", "electrician", "installer"]);
    const admin = await adminClient();
    const { data: row, error } = await admin.from("job_overview").select("*").eq("id", data.jobId).maybeSingle();
    if (error) throw new Error(`Job could not be loaded: ${error.message}`);
    if (!row) throw new Error("Job not found or no longer available.");
    if (role === "electrician" || role === "installer") {
      // Trades see owner name/contact/exact address only while their own visit is current (SQL has_contact_release),
      // or on a partner-supplied job their own business originated.
      const { data: rel } = await admin.rpc("has_contact_release", { _job: data.jobId, _user: context.userId });
      let own = false;
      if (!rel && row.channel === "installer_sourced") {
        const { data: j } = await admin.from("jobs").select("originating_installer_business_id").eq("id", data.jobId).maybeSingle();
        const { data: m } = j?.originating_installer_business_id ? await admin.from("business_members").select("user_id").eq("business_id", j.originating_installer_business_id).eq("user_id", context.userId).maybeSingle() : { data: null };
        own = !!m;
      }
      if (!rel && !own) {
        const { data: p } = await admin.from("properties").select("suburb, postcode").eq("id", row.property_id!).maybeSingle();
        return { ...row, owner_name: null, owner_phone: null, owner_email: null, property_address: [p?.suburb, p?.postcode].filter(Boolean).join(" ") || "Address shared once the visit is arranged" };
      }
    }
    if (role === "admin" && row.stage === "cancelled") {
      const { data: c } = await admin.from("jobs").select("cancelled_reason").eq("id", data.jobId).maybeSingle();
      return { ...row, cancelled_reason: c?.cancelled_reason ?? null };
    }
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