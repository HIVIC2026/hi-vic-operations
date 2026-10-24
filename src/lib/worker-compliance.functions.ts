// Electrician licence expiry + installer PIISA training: trade "Add it" prompts and office verification.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { approvalFlags, eecState, licenceWarning, missingItems, piisaState } from "./worker-compliance.core";
import { eecUploadMeta, mergeEec } from "./worker-invite.core";

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
const COLS = "id, business_id, profile_id, trade_role, full_legal_name, email, licence_expires_on, piisa_status, piisa_completed_on, piisa_certificate_path, piisa_verified_at, approval_status, removed_at, certification_status, certification";

/** Decision 130: attach each installer's ESC collection notice state so flags, prompts and offer blocking share one rule. */
async function withNoticeAck<T extends { id: string; business_id: string; email: string; full_legal_name: string; trade_role: string; removed_at: string | null }>(rows: T[]) {
  const map = await (await import("./esc-collection-notice.server")).noticeAckMap(rows);
  return rows.map((w) => ({ ...w, collection_notice_acknowledged: w.trade_role === "installer" ? map.get(w.id) ?? null : null }));
}

/** The caller may edit a worker if it's their own record or they're an active member of the worker's business. */
async function canEditWorker(sb: { from: (t: string) => any }, userId: string, workerId: string) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: w } = await admin.from("partner_workers").select(COLS).eq("id", workerId).is("removed_at", null).maybeSingle();
  if (!w) throw new Error("That team member wasn't found.");
  if (w.profile_id === userId) return { admin, w };
  const { data: m } = await sb.from("business_members").select("business_id, member_role").eq("user_id", userId).eq("business_id", w.business_id).eq("active", true).maybeSingle();
  if (!m || m.member_role !== "business_admin") throw new Error("Only the business owner can update other team members.");
  return { admin, w };
}

export const myTeamCompliance = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: mem } = await context.supabase.from("business_members").select("business_id, member_role").eq("user_id", context.userId).eq("active", true);
    const ids = (mem ?? []).filter((m) => m.member_role === "business_admin").map((m) => m.business_id); // staff see only their own record
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const q = admin.from("partner_workers").select(COLS).is("removed_at", null);
    const { data } = ids.length ? await q.or(`business_id.in.(${ids.join(",")}),profile_id.eq.${context.userId}`) : await q.eq("profile_id", context.userId);
    const t = today();
    return (await withNoticeAck(data ?? [])).map((w) => ({ id: w.id, name: w.full_legal_name, role: w.trade_role, missing: missingItems(w as never), warning: licenceWarning(w as never, t), piisa: piisaState(w as never), eec: eecState(w as never), licenceExpiry: w.licence_expires_on, selfProfile: w.profile_id === context.userId }));
  });

export const addLicenceExpiry = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid, expiry: ymd }).parse(d))
  .handler(async ({ data, context }) => {
    const { admin, w } = await canEditWorker(context.supabase as never, context.userId, data.workerId);
    if (w.trade_role !== "electrician") throw new Error("Only electricians have a licence expiry here.");
    if (data.expiry < today()) throw new Error("That date has passed. Enter the new expiry date.");
    const { error } = await admin.from("partner_workers").update({ licence_expires_on: data.expiry }).eq("id", w.id);
    if (error) throw new Error("Couldn't save. Please try again.");
    return { ok: true };
  });

export const piisaUploadSlot = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid, contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(10 * 1024 * 1024) }).parse(d))
  .handler(async ({ data, context }) => {
    const { admin, w } = await canEditWorker(context.supabase as never, context.userId, data.workerId);
    if (w.trade_role !== "installer") throw new Error("PIISA training is for installers.");
    const ext = data.contentType === "application/pdf" ? "pdf" : data.contentType === "image/png" ? "png" : "jpg";
    const path = `workers/${w.id}/piisa-${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await admin.storage.from("partner-files").createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Couldn't prepare the upload. Please try again.");
    return { path, token: signed.token as string };
  });

export const savePiisa = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid, completedOn: ymd, path: z.string().max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const { admin, w } = await canEditWorker(context.supabase as never, context.userId, data.workerId);
    if (!data.path.startsWith(`workers/${w.id}/piisa-`)) throw new Error("Invalid upload.");
    if (data.completedOn > today()) throw new Error("The date can't be in the future.");
    const { data: list } = await admin.storage.from("partner-files").list(`workers/${w.id}`, { search: data.path.split("/").pop() ?? "" });
    if (!list?.length) throw new Error("Upload not found. Please try again.");
    { const { allowedUpload } = await import("./upload-safety.core"); const { verifyStoredUpload } = await import("./upload-safety.server"); const m = allowedUpload(data.path, null); if (!m) throw new Error("That file type isn't accepted."); await verifyStoredUpload("partner-files", data.path, m); }
    const { error } = await admin.from("partner_workers").update({ piisa_status: "done", piisa_completed_on: data.completedOn, piisa_certificate_path: data.path, piisa_verified_at: null, piisa_verified_by: null }).eq("id", w.id);
    if (error) throw new Error("Couldn't save. Please try again.");
    return { ok: true };
  });

/** Office: workers with licence/PIISA flags (30-day licence warnings included). */
export const officeWorkerCompliance = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data } = await admin.from("partner_workers").select(`${COLS}, businesses(name, trading_name)`).is("removed_at", null);
    const t = today();
    // Decision 153: verified installers also need a recorded level + unexpired date to be cleared; surface what is missing.
    const { crewClearance } = await import("./worker-compliance.core");
    const facts = await latestCertFacts(admin as never, (data ?? []).filter((w) => w.trade_role === "installer"));
    return (await withNoticeAck(data ?? [])).map((w) => {
      const f = facts.get(w.id);
      const row = f ? { ...w, cii_level: f.level, cii_expires_on: f.expiresOn } : w;
      const cl = f && eecState(w as never) === "verified" ? crewClearance({ certStatus: f.certStatus ?? "verified", level: f.level, expiresOn: f.expiresOn }, t) : null;
      return { id: w.id, name: w.full_legal_name, role: w.trade_role, business: (w.businesses as { trading_name: string | null; name: string } | null)?.trading_name ?? (w.businesses as { name: string } | null)?.name ?? null, flags: approvalFlags(row as never, t), warning: licenceWarning(w as never, t), piisa: piisaState(w as never), hasPiisaFile: !!w.piisa_certificate_path, eec: eecState(w as never), escNotice: w.collection_notice_acknowledged,
        cii: cl ? { level: f!.level, expiresOn: f!.expiresOn, cleared: cl.cleared, reason: cl.reason } : null, certNumber: (w.certification as { eec_upload?: { number?: string | null } } | null)?.eec_upload?.number ?? null };
    }).filter((r) => r.flags.length || r.warning);
  });

/** Office: short-lived signed link to the worker's uploaded EEC/CII certificate (never a public URL). */
export const officeEecFileUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await admin.from("partner_workers").select("certification").eq("id", data.workerId).maybeSingle();
    const path = (w?.certification as { eec_upload?: { path?: string | null } } | null)?.eec_upload?.path ?? null;
    if (!path) throw new Error("No certificate uploaded.");
    const { signFile } = await import("./file-links.server");
    const { data: s } = await signFile("partner-files", path, 300);
    return { url: s?.signedUrl ?? null };
  });

/** Decision 153: latest certification check per worker (by id or email) + the latest recorded level/expiry against it. Read-only. */
async function latestCertFacts(admin: { from: (t: string) => any }, workers: { id: string; email: string }[]) {
  const out = new Map<string, { certStatus: string | null; certId: string | null; level: string | null; expiresOn: string | null }>();
  if (!workers.length) return out;
  const emails = workers.map((w) => w.email.trim().toLowerCase());
  const { data: certs } = await admin.from("partner_worker_certifications").select("id, worker_id, worker_email, status, recorded_at")
    .or(`worker_id.in.(${workers.map((w) => w.id).join(",")}),worker_email.in.(${emails.map((e) => `"${e}"`).join(",")})`).order("recorded_at", { ascending: false });
  const ids = ((certs ?? []) as { id: string }[]).map((c) => c.id);
  const { data: levels } = ids.length ? await admin.from("worker_certification_levels").select("certification_id, level, expires_on, recorded_at").in("certification_id", ids).order("recorded_at", { ascending: false }) : { data: [] };
  for (const w of workers) {
    const c = ((certs ?? []) as { id: string; worker_id: string | null; worker_email: string; status: string }[]).find((r) => r.worker_id === w.id || r.worker_email.trim().toLowerCase() === w.email.trim().toLowerCase()) ?? null;
    const l = c ? ((levels ?? []) as { certification_id: string; level: string; expires_on: string }[]).find((r) => r.certification_id === c.id) ?? null : null;
    out.set(w.id, { certStatus: c?.status ?? null, certId: c?.id ?? null, level: l?.level ?? null, expiresOn: l?.expires_on ?? null });
  }
  return out;
}

/** Office: verify an uploaded EEC/CII certificate and record its level + expiry from the check (decision 153). Writes the
 *  permanent certification check row + level row (append-only), links it on the worker (`certification.verification_id`) and sets
 *  certification_status='verified'. That recorded check is what clears the person for crews/offers — approval_status (logins) is untouched.
 *  Also used to re-record a renewed certificate once the recorded one has expired. */
export const officeVerifyEec = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid, certificateNumber: z.string().trim().min(1).max(80), level: z.enum(["full", "provisional"]), expiresOn: ymd }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await admin.from("partner_workers").select("id, email, trade_role, certification_status, certification").eq("id", data.workerId).is("removed_at", null).maybeSingle();
    if (!w || w.trade_role !== "installer") throw new Error("EEC certificate checks are only for installer workers.");
    const upload = (w.certification as { eec_upload?: { path?: string | null; uploaded_at?: string; number?: string | null } } | null)?.eec_upload;
    if (!upload?.path) throw new Error("No certificate uploaded to verify.");
    const t = today();
    if (data.expiresOn < t) throw new Error("That expiry date has passed. Enter the expiry date shown on the certificate.");
    const { crewClearance } = await import("./worker-compliance.core");
    const cur = (await latestCertFacts(admin as never, [w])).get(w.id)!;
    if (crewClearance({ certStatus: cur.certStatus, level: cur.level, expiresOn: cur.expiresOn }, t).cleared) throw new Error(`This certificate is already verified and current (${cur.level}, expires ${cur.expiresOn}).`);
    const now = new Date().toISOString();
    const email = w.email.trim().toLowerCase();
    const { data: cert, error: ce } = await admin.from("partner_worker_certifications").insert({
      worker_id: w.id, worker_email: email, status: "verified", certificate_number: data.certificateNumber, issuer: null,
      evidence_source: "certificate_sighted", evidence_note: `Office verified the uploaded EEC/CII certificate (${data.level}, expires ${data.expiresOn}).`, recorded_by: context.userId,
    }).select("id").single();
    if (ce || !cert) throw new Error("Couldn't record the certificate check. Please try again.");
    const { error: le } = await admin.from("worker_certification_levels").insert({ certification_id: cert.id, worker_email: email, level: data.level, expires_on: data.expiresOn, recorded_by: context.userId });
    if (le) throw new Error("Certificate check recorded, but the level/expiry didn't save. Please try again.");
    const { error } = await admin.from("partner_workers").update({
      certification_status: "verified",
      certification: mergeEec(w.certification, { ...eecUploadMeta(upload.path, upload.uploaded_at ?? now, upload.number ?? data.certificateNumber), verification_id: cert.id, eec_verified_at: now, eec_verified_by: context.userId } as never) as never,
    }).eq("id", w.id);
    if (error) throw new Error("Couldn't verify the certificate. Please try again.");
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "eec_certificate_verified", summary: `EEC/CII certificate verified (${data.level}, expires ${data.expiresOn})`, details: { worker_id: w.id, certification_id: cert.id, level: data.level, expires_on: data.expiresOn } });
    return { ok: true };
  });

export const officeVerifyPiisa = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await admin.from("partner_workers").update({ piisa_verified_at: new Date().toISOString(), piisa_verified_by: context.userId }).eq("id", data.workerId).not("piisa_certificate_path", "is", null).select("id").maybeSingle();
    if (!row) throw new Error("No PIISA certificate to verify yet.");
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "piisa_verified", summary: "PIISA certificate verified", details: { worker_id: data.workerId } });
    return { ok: true };
  });

export const officePiisaFileUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await admin.from("partner_workers").select("piisa_certificate_path").eq("id", data.workerId).maybeSingle();
    if (!w?.piisa_certificate_path) throw new Error("No certificate uploaded.");
    const { signFile } = await import("./file-links.server");
    const { data: s } = await signFile("partner-files", w.piisa_certificate_path, 300);
    return { url: s?.signedUrl ?? null };
  });
