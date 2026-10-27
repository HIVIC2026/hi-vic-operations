import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { coverageAreas, coveragePartnerBlocker, overallCoverage, tradeCoverage, type CoveragePartner } from "./coverage.core";
import { customerCommsEnabled, hasCurrentOwnerContactConsent, recordCommunication } from "./comms.server";
import { configuredDeliveryAdapter } from "./delivery.server";
import { suppressionFor, unsubscribeUrlForJob } from "./emailsafety.server";
import { withUnsubscribe } from "./emailsafety.core";
import { renderCoverageUnavailableEmail } from "./coverage-email";

const uuid = z.string().uuid();

// One job is read by id; the full list is read in pages (Jo 27 Oct 2026, HV-3385: the database returns at most 1,000 rows,
// so with 2,000+ open jobs newer ones were "not found" and showed "Coverage could not be checked").
async function coverageJobs(admin: typeof import("@/integrations/supabase/client.server").supabaseAdmin, jobId?: string) {
  const cols = "id,job_number,stage,source,properties(address_line,suburb,postcode)";
  if (jobId) return admin.from("jobs").select(cols).eq("id", jobId);
  const all: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("jobs").select(cols).not("stage", "in", "(complete,cancelled)").neq("source", "qa_test").order("id").range(from, from + 999);
    if (error) return { data: null, error };
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) return { data: all as NonNullable<typeof data>, error: null };
  }
}

async function loadCoverageData(jobId?: string) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const [{ data: businesses, error: businessesError }, { data: credentials, error: credentialsError }, { data: jobs, error: jobsError }, { data: workers, error: workersError }, { data: members, error: membersError }] = await Promise.all([
    admin.from("businesses").select("id,name,trading_name,business_type,capabilities,onboarding_status,is_active,service_postcodes,service_regions,coverage_verified_at,declared_service_origin,declared_travel_radius_km,declared_excluded_areas,free_measureups_for_hivic_quote_leads"),
    admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification"),
    coverageJobs(admin, jobId),
    admin.from("partner_workers").select("id,business_id,full_legal_name,trade_role,approval_status,removed_at").is("removed_at", null),
    admin.from("business_members").select("business_id,user_id,member_role,active,profiles!business_members_user_id_fkey(full_name)").eq("active", true),
  ]);
  const error = businessesError ?? credentialsError ?? jobsError ?? workersError ?? membersError;
  if (error) throw new Error(`Coverage could not be loaded: ${error.message}`);
  const partners: CoveragePartner[] = (businesses ?? []).map((business) => ({
    ...business,
    name: business.trading_name || business.name,
    credentials: (credentials ?? []).filter((credential) => credential.business_id === business.id),
  })) as CoveragePartner[];
  return { partners, jobs: jobs ?? [], workers: workers ?? [], members: members ?? [] };
}

export const getAdminCoverage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { partners, jobs, workers, members } = await loadCoverageData();
  const rows = jobs.filter((job) => job.source !== "qa_test").map((job) => {
    const property = job.properties as { address_line: string; suburb: string | null; postcode: string | null } | null;
    const site = { postcode: property?.postcode ?? null, suburb: property?.suburb ?? null };
    const rec = tradeCoverage(partners, "rec", site);
    const installer = tradeCoverage(partners, "installer", site);
    return { id: job.id, job_number: job.job_number, stage: job.stage, address: property?.address_line ?? "Address unavailable", suburb: site.suburb, postcode: site.postcode, rec, installer, overall: overallCoverage(rec, installer) };
  });
  const areas = coverageAreas(partners, rows.map((row) => ({ postcode: row.postcode, suburb: row.suburb })));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: enquiries, error: enquiriesError } = await supabaseAdmin.from("partner_enquiries")
    .select("id,enquiry_type,status,company,name,service_areas,cii_certification_status,rec_registration_number")
    .in("enquiry_type", ["electrician_rec", "installer"]).neq("status", "declined").or("source.is.null,source.not.in.(portal_rec_onboarding_test,portal_installer_onboarding_test)").order("created_at", { ascending: false });
  if (enquiriesError) throw new Error(`Partner enquiries could not be loaded: ${enquiriesError.message}`);
  return {
    rows,
    areas,
    potentialPartners: (enquiries ?? []).map((e) => ({ id: e.id, kind: e.enquiry_type === "installer" ? "installer" as const : "rec" as const, status: e.status, name: (e.company || e.name || "Unnamed").trim(), service_areas: e.service_areas ?? [], cii: e.cii_certification_status, rec_number: e.rec_registration_number })),
    partners: partners.map((partner) => ({
      id: partner.id, name: partner.name, business_type: partner.business_type, capabilities: partner.capabilities,
      onboarding_status: partner.onboarding_status, is_active: partner.is_active,
      service_postcodes: partner.service_postcodes ?? [], coverage_verified_at: partner.coverage_verified_at ?? null,
      declared_service_origin: partner.declared_service_origin ?? null, declared_travel_radius_km: partner.declared_travel_radius_km ?? null,
      declared_excluded_areas: partner.declared_excluded_areas ?? null, free_measureups_for_hivic_quote_leads: partner.free_measureups_for_hivic_quote_leads ?? null,
      blocker: coveragePartnerBlocker(partner, partner.business_type === "rec" || partner.capabilities?.includes("electrician") ? "rec" : "installer"),
      workers: workers.filter((worker) => worker.business_id === partner.id).map((worker) => ({ id: worker.id, name: worker.full_legal_name, trade_role: worker.trade_role, approved: worker.approval_status === "approved" })),
      members: members.filter((member) => member.business_id === partner.id).map((member) => ({ id: member.user_id, name: (member.profiles as unknown as { full_name: string | null } | null)?.full_name ?? "Business contact", member_role: member.member_role })),
    })),
  };
});

export const getJobCoverage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ jobId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { partners, jobs } = await loadCoverageData(data.jobId);
    const job = jobs.find((candidate) => candidate.id === data.jobId);
    if (!job) throw new Error("Job not found.");
    const property = job.properties as { suburb: string | null; postcode: string | null } | null;
    const site = { postcode: property?.postcode ?? null, suburb: property?.suburb ?? null };
    const rec = tradeCoverage(partners, "rec", site);
    const installer = tradeCoverage(partners, "installer", site);
    return { rec, installer, overall: overallCoverage(rec, installer), postcode: site.postcode, suburb: site.suburb };
  });

export const sendNoCoverageEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ jobId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { partners, jobs } = await loadCoverageData(data.jobId);
    const job = jobs.find((candidate) => candidate.id === data.jobId);
    if (!job) throw new Error("Job not found.");
    if (job.source === "qa_test") throw new Error("Customer email is blocked for TEST journeys. Nothing was sent.");
    const property = job.properties as { suburb: string | null; postcode: string | null } | null;
    const site = { postcode: property?.postcode ?? null, suburb: property?.suburb ?? null };
    const rec = tradeCoverage(partners, "rec", site);
    const installer = tradeCoverage(partners, "installer", site);
    if ([rec.state, installer.state].some((state) => state === "partial" || state === "not_configured")) throw new Error("Coverage is incomplete or unverified. Confirm partner postcodes before telling the customer the area is unavailable.");
    const missing: Array<"REC / electrician" | "installer"> = [];
    if (rec.state === "unserviceable") missing.push("REC / electrician");
    if (installer.state === "unserviceable") missing.push("installer");
    if (!missing.length) throw new Error("This enquiry has verified coverage for both trades.");
    const [{ data: contact, error: contactError }, commsEnabled, consent, adapter] = await Promise.all([
      (await import("@/integrations/supabase/client.server")).supabaseAdmin.from("jobs").select("external_enquiry_id,owners(full_name,email)").eq("id", data.jobId).single(),
      customerCommsEnabled(), hasCurrentOwnerContactConsent(data.jobId), configuredDeliveryAdapter(),
    ]);
    if (contactError) throw new Error(`Customer details could not be loaded: ${contactError.message}`);
    if (!commsEnabled) throw new Error("Customer communications are locked. Nothing was sent.");
    if (!consent) throw new Error("No current owner contact consent. Nothing was sent.");
    if (!adapter) throw new Error("Customer email delivery is not configured. Nothing was sent.");
    const owner = contact?.owners as { full_name: string | null; email: string | null } | null;
    if (!owner?.email) throw new Error("No owner email is recorded. Nothing was sent.");
    const suppressed = await suppressionFor(data.jobId, "area_unavailable", owner.email);
    if (suppressed) throw new Error(`Customer email is blocked: ${suppressed.replace(/_/g, " ")}. Nothing was sent.`);
    const key = `area_unavailable:${data.jobId}:${site.postcode ?? "unknown"}:${missing.join("+")}`;
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await admin.from("customer_email_sends").select("id,status").eq("idempotency_key", key).maybeSingle();
    if (existing && existing.status !== "failed") throw new Error("This service-area update was already sent or is already being processed.");
    const sendRow = existing ? existing : (await admin.from("customer_email_sends").insert({ job_id: data.jobId, purpose: "area_unavailable", idempotency_key: key }).select("id,status").single()).data;
    if (!sendRow) throw new Error("Email could not be reserved. Nothing was sent.");
    if (existing) await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", existing.id);
    let delivered = false;
    try {
      const mail = withUnsubscribe(renderCoverageUnavailableEmail({ firstName: owner.full_name?.trim().split(/\s+/)[0] ?? null, suburb: site.suburb, postcode: site.postcode, missing, reference: contact.external_enquiry_id }), await unsubscribeUrlForJob(data.jobId));
      const result = await adapter.deliver({ to: owner.email, subject: mail.subject, html: mail.html, text: mail.plainText, idempotencyKey: key, purpose: "area_unavailable" });
      delivered = true;
      const communicationId = await recordCommunication({ jobId: data.jobId, direction: "outbound", channel: "email", recipients: [owner.email], subject: mail.subject, body: mail.plainText, provider: adapter.provider, providerMessageId: result.providerMessageId, visibility: "customer", sourceEvent: "area_unavailable", sourceReference: key, createdBy: context.userId, deliveryStatus: "sent" });
      await admin.from("customer_email_sends").update({ status: "sent", sent_at: new Date().toISOString(), provider: adapter.provider, provider_message_id: result.providerMessageId, communication_id: communicationId }).eq("id", sendRow.id);
      return { sent: true };
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      const { statusAfterDeliveryError } = await import("./delivery.core");
      const st = statusAfterDeliveryError(error, delivered); delivered = st !== "failed";
      await admin.from("customer_email_sends").update({ status: st, error: message, ...(delivered ? { sent_at: new Date().toISOString() } : {}) }).eq("id", sendRow.id);
      throw new Error(delivered ? "The email may have been sent (the provider did not answer clearly). It will not be resent automatically." : `Email was not sent: ${message}`);
    }
  });