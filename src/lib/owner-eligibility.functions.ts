import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hashToken, isTokenShape, newToken } from "./worker-links.core";
import { OWNER_LINK_DAYS, OUTCOME_LABEL, evaluateOwnerAnswers, validateOwnerAnswers } from "./owner-eligibility.core";

const uuid = z.string().uuid();
const DAY = 86_400_000;

/** Office, or a member of the installer company that brought the job. Returns the job's installer business. */
async function authorise(sb: { rpc: (n: "is_admin") => PromiseLike<{ data: unknown }> }, userId: string, jobIds: string[]) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: jobs, error } = await admin.from("jobs").select("id, channel, originating_installer_business_id, job_number, owner_id, property_id").in("id", jobIds);
  if (error) throw new Error(error.message);
  if (!jobs?.length || jobs.length !== jobIds.length) throw new Error("Job not found.");
  for (const j of jobs) if (j.channel !== "installer_sourced") throw new Error(`${j.job_number} is not an installer-supplied job – the owner eligibility link is only for installer-supplied customers.`);
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (isAdmin !== true) {
    const { myBusinesses } = await import("./pilot.server");
    const mine = await myBusinesses(userId);
    for (const j of jobs) if (!j.originating_installer_business_id || !mine.has(j.originating_installer_business_id)) throw new Error("You can only create links for your own company's customers.");
  }
  return { admin, jobs };
}

async function issue(admin: Awaited<ReturnType<typeof authorise>>["admin"], job: { id: string; originating_installer_business_id: string | null }, userId: string) {
  const now = Date.now();
  // One live link per job: making a new one switches the old one off (only hashes are stored).
  await admin.from("owner_eligibility_links").update({ revoked_at: new Date(now).toISOString() }).eq("job_id", job.id).is("revoked_at", null).is("submitted_at", null);
  const token = newToken();
  const { error } = await admin.from("owner_eligibility_links").insert({ job_id: job.id, business_id: job.originating_installer_business_id, token_hash: await hashToken(token), created_by: userId, expires_at: new Date(now + OWNER_LINK_DAYS * DAY).toISOString() });
  if (error) throw new Error(error.message);
  const { logEvent } = await import("./workflow.server");
  await logEvent(job.id, userId, "owner_eligibility_link_created", "Owner eligibility link created (copy and send manually – nothing is sent automatically)", {}, { internal: true });
  return `/eligibility/${token}`;
}

export const createOwnerEligibilityLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { admin, jobs } = await authorise(context.supabase as never, context.userId, [data.jobId]);
    return { path: await issue(admin, jobs[0]!, context.userId) };
  });

/** Whole upload batch: one fresh link per created job, returned as copyable lines. */
export const createBatchOwnerEligibilityLinks = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batchId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin0 } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await admin0.from("bulk_import_rows").select("job_id").eq("batch_id", data.batchId).not("job_id", "is", null);
    const ids = [...new Set((rows ?? []).map((r) => r.job_id!))];
    if (!ids.length) throw new Error("No jobs have been created from this upload yet.");
    const { admin, jobs } = await authorise(context.supabase as never, context.userId, ids);
    const { formatPropertyAddress } = await import("./address");
    const [{ data: owners }, { data: props }, { data: done }] = await Promise.all([
      admin.from("owners").select("id, full_name").in("id", jobs.map((j) => j.owner_id)),
      admin.from("properties").select("id, address_line, suburb, state, postcode").in("id", jobs.map((j) => j.property_id)),
      admin.from("owner_eligibility_links").select("job_id").in("job_id", ids).not("submitted_at", "is", null),
    ]);
    const answered = new Set((done ?? []).map((d) => d.job_id));
    const out: { jobNumber: string; owner: string; address: string; path: string | null; answered: boolean }[] = [];
    for (const j of jobs) {
      const o = owners?.find((x) => x.id === j.owner_id); const p = props?.find((x) => x.id === j.property_id);
      const isDone = answered.has(j.id);
      out.push({ jobNumber: j.job_number, owner: o?.full_name ?? "", address: formatPropertyAddress(p), path: isDone ? null : await issue(admin, j, context.userId), answered: isDone });
    }
    return { links: out.sort((a, b) => a.jobNumber.localeCompare(b.jobNumber)) };
  });

export const jobOwnerEligibility = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: job } = await context.supabase.from("jobs").select("channel").eq("id", data.jobId).maybeSingle();
    if (job?.channel !== "installer_sourced") return { applicable: false as const };
    // RLS: office or the job's installer company only.
    const { data: rows } = await context.supabase.from("owner_eligibility_links").select("id, created_at, expires_at, revoked_at, submitted_at, result, result_reasons").eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(5);
    const latest = rows?.find((r) => r.submitted_at) ?? rows?.[0] ?? null;
    return { applicable: true as const, latest: latest ? { ...latest, label: latest.result ? OUTCOME_LABEL[latest.result as keyof typeof OUTCOME_LABEL] : null } : null };
  });

// ---------- Public: the owner's question page (token is the only credential) ----------
async function resolve(token: string) {
  if (!isTokenShape(token)) throw new Error("This link isn't valid.");
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: l } = await admin.from("owner_eligibility_links").select("id, job_id, business_id, expires_at, revoked_at, submitted_at, result").eq("token_hash", await hashToken(token)).maybeSingle();
  if (!l) throw new Error("This link isn't valid.");
  if (l.revoked_at) throw new Error("This link has been replaced. Please use the newest link you were sent.");
  if (!l.submitted_at && new Date(l.expires_at).getTime() <= Date.now()) throw new Error("This link has expired. Please ask for a new one.");
  return { admin, l };
}

export const getOwnerEligibilityForm = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { admin, l } = await resolve(data.token);
    const [{ data: job }, { data: biz }] = await Promise.all([
      admin.from("jobs").select("property_id, properties(suburb)").eq("id", l.job_id).maybeSingle(),
      l.business_id ? admin.from("businesses").select("name, trading_name").eq("id", l.business_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return {
      suburb: (job?.properties as { suburb: string | null } | null)?.suburb ?? null,
      installer: biz?.trading_name || biz?.name || null,
      done: l.submitted_at ? { label: OUTCOME_LABEL[l.result as keyof typeof OUTCOME_LABEL] } : null,
    };
  });

export const submitOwnerEligibility = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(80), answers: z.record(z.string(), z.string().max(20)) }).parse(d))
  .handler(async ({ data }) => {
    const { admin, l } = await resolve(data.token);
    if (l.submitted_at) return { label: OUTCOME_LABEL[l.result as keyof typeof OUTCOME_LABEL] };
    const a = validateOwnerAnswers(data.answers);
    if (typeof a === "string") throw new Error(a);
    const { data: job } = await admin.from("jobs").select("job_number, properties(state, postcode)").eq("id", l.job_id).single();
    const p = (job?.properties as { state: string | null; postcode: string | null } | null) ?? { state: null, postcode: null };
    const { todayMelbourne } = await import("./eligibility.server");
    const today = todayMelbourne();
    const r = evaluateOwnerAnswers(a, p, Number(today.slice(0, 4)), today);
    const { error, data: upd } = await admin.from("owner_eligibility_links").update({ answers: a, result: r.result, result_reasons: r.reasons, ruleset_version: r.ruleset, submitted_at: new Date().toISOString() }).eq("id", l.id).is("submitted_at", null).select("id");
    if (error) throw new Error("Your answers couldn't be saved. Please try again.");
    if (upd?.length) {
      // Installer told: visible in the job history for the office and the installer company. Nothing is emailed/texted.
      const { logEvent } = await import("./workflow.server");
      await logEvent(l.job_id, null, "owner_eligibility_result", `Owner answered the eligibility questions: ${r.label}${r.reasons.length ? ` – ${r.reasons.join("; ")}` : ""}`, { result: r.result, reasons: r.reasons, ruleset: r.ruleset });
    }
    return { label: r.label };
  });
