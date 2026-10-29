import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";
import { hashToken, isTokenShape, newToken } from "./worker-links.core";
import { INVITE_STATE_MESSAGE, WORKER_DECLARATIONS_VERSION, completionErrors, eecUploadMeta, hasEecUpload, inviteExpiry, inviteMode, inviteState, isInviteCertPath, mergeEec, signLinkBlocker, workerDeclarations, workerSubmissionErrors } from "./worker-invite.core";

type AdminDb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
/** One partner_workers row with `declarations_due`. Until 0230 is live the column is missing: re-read without it and
 *  treat the person as not due (preflight ruling 10). */
async function workerWithDue<T>(admin: AdminDb, id: string, cols: string): Promise<(T & { declarations_due: boolean }) | null> {
  const load = (c: string) => admin.from("partner_workers").select(c).eq("id", id).maybeSingle();
  let { data, error } = await load(`${cols}, declarations_due`);
  if (error && (await import("./schema-compat.core")).isMissingDbObject(error)) ({ data, error } = await load(cols));
  if (error || !data) return null;
  return { ...(data as T), declarations_due: (data as { declarations_due?: unknown }).declarations_due === true };
}

const uuid = z.string().uuid();
const trade = z.enum(["electrician", "installer"]);

// ---------- Business owner: create / list / cancel invites ----------
export const listWorkerInvites = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("partner_worker_invites")
      .select("id, invitee_name, invitee_contact, trade_role, expires_at, used_at, revoked_at, created_at")
      .eq("business_id", data.businessId).order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(`Could not load invites: ${error.message}`);
    const now = Date.now();
    return (rows ?? []).map((r) => ({ ...r, state: inviteState(r, now) }));
  });

export const createWorkerInvite = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, name: z.string().trim().min(2).max(200), contact: z.string().trim().max(254).optional().nullable(), mobile: z.string().trim().max(30).optional().nullable(), trade }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireMember } = await import("./pilot.server");
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) await requireMember(context.userId, data.businessId, true);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const token = newToken();
    const { data: row, error } = await admin.from("partner_worker_invites").insert({
      business_id: data.businessId, created_by: context.userId, invitee_name: data.name, invitee_contact: data.contact ?? null,
      trade_role: data.trade, token_hash: await hashToken(token), expires_at: inviteExpiry(Date.now()),
    }).select("id, created_at").single();
    if (error || !row) throw new Error(`Could not create invite: ${error?.message ?? "no row"}`);
    // Decision 251: text the new person their link when a mobile is given (guarded sender; TEST → test-send). The token
    // is still returned so the owner can pass the link on themself whenever the text does not go.
    const text = data.mobile?.trim()
      ? await (await import("./installer-texts.server")).textTeamMemberInvite({ inviteId: row.id, businessId: data.businessId, mobile: data.mobile, token, createdAt: row.created_at })
      : null;
    return { token, text };
  });

export const revokeWorkerInvite = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await admin.from("partner_worker_invites").select("id, business_id").eq("id", data.id).maybeSingle();
    if (!inv) throw new Error("Invite not found.");
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) { const { requireMember } = await import("./pilot.server"); await requireMember(context.userId, inv.business_id, true); }
    const { error } = await admin.from("partner_worker_invites").update({ revoked_at: new Date().toISOString() }).eq("id", inv.id).is("used_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Worker: public, token-verified ----------
export const getWorkerInvite = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string() }).parse(d))
  .handler(async ({ data }) => {
    if (!isTokenShape(data.token)) return { ok: false as const, message: "This invite link isn't valid. Check you copied the whole link." };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await admin.from("partner_worker_invites")
      .select("id, invitee_name, trade_role, expires_at, used_at, revoked_at, worker_id, businesses(name, trading_name)")
      .eq("token_hash", await hashToken(data.token)).maybeSingle();
    if (!inv) return { ok: false as const, message: "This invite link isn't valid. Check you copied the whole link." };
    const st = inviteState(inv, Date.now());
    if (st !== "active") return { ok: false as const, message: INVITE_STATE_MESSAGE[st] };
    const biz = inv.businesses as { name: string; trading_name: string | null } | null;
    const businessName = biz?.trading_name || biz?.name || "your business";
    const t = inv.trade_role as "electrician" | "installer";
    const mode = inviteMode(inv);
    if (mode === "registration") return { ok: true as const, mode, inviteeName: inv.invitee_name, trade: t, businessName, declarations: workerDeclarations(t, businessName), needsCert: t === "installer" };
    // Completion: people added on Team (declarations_due) sign the declarations here; the certificate only when missing.
    const w = await workerWithDue<{ certification: unknown }>(admin as never, inv.worker_id!, "certification");
    const due = w?.declarations_due === true;
    return { ok: true as const, mode, inviteeName: inv.invitee_name, trade: t, businessName, declarations: due ? workerDeclarations(t, businessName) : [], needsCert: t === "installer" && !hasEecUpload(w?.certification) };
  });

/** Verify the worker's certificate upload exists in private storage and the bytes match an accepted type. */
async function verifyInviteCertUpload(admin: { storage: { from: (b: string) => any } }, inviteId: string, path: string) {
  if (!isInviteCertPath(inviteId, path)) throw new Error("Invalid upload.");
  const { data: list } = await admin.storage.from("partner-files").list(`worker-invites/${inviteId}`, { search: path.split("/").pop() ?? "" });
  if (!list?.length) throw new Error("Upload not found. Please try again.");
  const { allowedUpload } = await import("./upload-safety.core");
  const { verifyStoredUpload } = await import("./upload-safety.server");
  const m = allowedUpload(path, null);
  if (!m) throw new Error("That file type isn't accepted.");
  await verifyStoredUpload("partner-files", path, m);
}

/** Public signed upload slot for the EEC/CII certificate, gated by the invite token (same pattern as PIISA). */
export const workerInviteCertSlot = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string(), contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(10 * 1024 * 1024) }).parse(d))
  .handler(async ({ data }) => {
    if (!isTokenShape(data.token)) throw new Error("This invite link isn't valid.");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await admin.from("partner_worker_invites").select("id, expires_at, used_at, revoked_at").eq("token_hash", await hashToken(data.token)).maybeSingle();
    if (!inv) throw new Error("This invite link isn't valid.");
    const st = inviteState(inv, Date.now());
    if (st !== "active") throw new Error(INVITE_STATE_MESSAGE[st]);
    const ext = data.contentType === "application/pdf" ? "pdf" : data.contentType === "image/png" ? "png" : "jpg";
    const path = `worker-invites/${inv.id}/eec-${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await admin.storage.from("partner-files").createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Couldn't prepare the upload. Please try again.");
    return { path, token: signed.token as string };
  });

/** Business owner: create a single-use completion link so an existing worker can upload their own certificate. */
export const createWorkerCompletionLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const w = await workerWithDue<{ id: string; business_id: string; full_legal_name: string; trade_role: string; removed_at: string | null; certification_status: string | null; email: string | null; mobile: string | null }>(admin as never, data.workerId, "id, business_id, full_legal_name, trade_role, removed_at, certification_status, email, mobile");
    if (!w || w.removed_at) throw new Error("That team member wasn't found.");
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) { const { requireMember } = await import("./pilot.server"); await requireMember(context.userId, w.business_id, true); }
    const blocker = signLinkBlocker(w);
    if (blocker) throw new Error(blocker);
    const token = newToken();
    const { error } = await admin.from("partner_worker_invites").insert({
      business_id: w.business_id, created_by: context.userId, invitee_name: w.full_legal_name,
      trade_role: w.trade_role as "electrician" | "installer", worker_id: w.id, token_hash: await hashToken(token), expires_at: inviteExpiry(Date.now()),
    });
    if (error) throw new Error(`Could not create the link: ${error.message}`);
    return { token };
  });

export const submitWorkerInvite = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({
    token: z.string(),
    full_legal_name: z.string().trim().max(200), mobile: z.string().trim().max(30), email: z.string().trim().toLowerCase().max(254),
    licence_number: z.string().trim().max(60).optional(), qualification: z.string().trim().max(200).optional(),
    certificate_path: z.string().trim().max(300).optional(), certificate_number: z.string().trim().max(60).optional(),
    accepted: z.array(z.string().max(40)).max(20), signed_name: z.string().trim().max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (!isTokenShape(data.token)) return { ok: false as const, errors: ["This invite link isn't valid."] };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await admin.from("partner_worker_invites")
      .select("id, business_id, trade_role, expires_at, used_at, revoked_at, created_by, worker_id, businesses(name, trading_name)")
      .eq("token_hash", await hashToken(data.token)).maybeSingle();
    if (!inv) return { ok: false as const, errors: ["This invite link isn't valid."] };
    const st = inviteState(inv, Date.now());
    if (st !== "active") return { ok: false as const, errors: [INVITE_STATE_MESSAGE[st]] };
    const t = inv.trade_role as "electrician" | "installer";
    const now = new Date().toISOString();

    // ---- Completion mode: an existing worker uploads their own missing certificate. Never inserts a worker. ----
    if (inviteMode(inv) === "completion") {
      const w = await workerWithDue<{ id: string; trade_role: string; removed_at: string | null; certification_status: string | null; certification: unknown }>(admin as never, inv.worker_id!, "id, trade_role, removed_at, certification_status, certification");
      const gone = ["This completion link is no longer available. Ask the business owner for a new one."];
      if (!w || w.removed_at) return { ok: false as const, errors: gone };
      const due = w.declarations_due;
      // Electricians only ever get a link to sign their declarations; installers also for the certificate.
      if (w.trade_role !== "installer" && !due) return { ok: false as const, errors: gone };
      if (!due && w.certification_status === "verified") return { ok: false as const, errors: ["This certificate is already verified — nothing more to do."] };
      const wt = w.trade_role as "electrician" | "installer";
      const biz = inv.businesses as { name: string; trading_name: string | null } | null;
      const decls = due ? workerDeclarations(wt, biz?.trading_name || biz?.name || "your business") : [];
      // Certificate-only links keep today's rule (always asked); a signing link asks only when none is uploaded yet.
      const needsCert = wt === "installer" && (!due || !hasEecUpload(w.certification));
      const errors = completionErrors(data, { cert: needsCert, declarationKeys: decls.map((d) => d.key) });
      if (errors.length) return { ok: false as const, errors };
      const certPath = data.certificate_path?.trim() || null;
      if (certPath) {
        try {
          // The file must exist and be a valid type BEFORE the single-use link is consumed.
          await verifyInviteCertUpload(admin as never, inv.id, certPath);
        } catch (e) {
          return { ok: false as const, errors: [e instanceof Error ? e.message : "Upload not found. Please try again."] };
        }
      }
      const { data: claimed } = await admin.from("partner_worker_invites").update({ used_at: now }).eq("id", inv.id).is("used_at", null).is("revoked_at", null).select("id");
      if (!claimed?.length) return { ok: false as const, errors: ["This link has already been used."] };
      if (certPath) {
        const { error: ue } = await admin.from("partner_workers").update({
          // certification_status stays 'unverified' — the office must verify. Existing JSON fields are preserved.
          certification: mergeEec(w.certification, eecUploadMeta(certPath, now, data.certificate_number)) as never,
        }).eq("id", w.id);
        if (ue) {
          await admin.from("partner_worker_invites").update({ used_at: null }).eq("id", inv.id);
          return { ok: false as const, errors: ["We couldn't save your certificate. Please try again."] };
        }
      }
      if (due) {
        // Same signed record as registration, then the person is no longer held back from jobs.
        const { error: se } = await admin.from("partner_worker_invites").update({
          signed_name: data.signed_name, declarations: { version: WORKER_DECLARATIONS_VERSION, accepted: decls, signed_at: now },
        }).eq("id", inv.id);
        const { error: de } = se ? { error: se } : await admin.from("partner_workers").update({ declarations_due: false } as never).eq("id", w.id);
        if (de) {
          await admin.from("partner_worker_invites").update({ used_at: null }).eq("id", inv.id);
          return { ok: false as const, errors: ["We couldn't save your signature. Please try again."] };
        }
      }
      await admin.from("partner_worker_invites").update({ signed_ip: context.ip, signed_user_agent: context.userAgent }).eq("id", inv.id);
      return { ok: true as const };
    }

    // ---- Registration mode: full details + declarations (+ required certificate for installers). ----
    const biz = inv.businesses as { name: string; trading_name: string | null } | null;
    const decls = workerDeclarations(t, biz?.trading_name || biz?.name || "your business");
    const errors = workerSubmissionErrors(t, data, decls.map((x) => x.key));
    if (errors.length) return { ok: false as const, errors };
    if (t === "installer") {
      try {
        await verifyInviteCertUpload(admin as never, inv.id, data.certificate_path!);
      } catch (e) {
        return { ok: false as const, errors: [e instanceof Error ? e.message : "Upload not found. Please try again."] };
      }
    }
    // Claim the invite first so it can only ever be used once.
    const { data: claimed } = await admin.from("partner_worker_invites").update({ used_at: now }).eq("id", inv.id).is("used_at", null).is("revoked_at", null).select("id");
    if (!claimed?.length) return { ok: false as const, errors: ["This invite link has already been used."] };
    const { data: w, error } = await admin.from("partner_workers").insert({
      business_id: inv.business_id, full_legal_name: data.full_legal_name, email: data.email, mobile: data.mobile, trade_role: t,
      licence_number: t === "electrician" ? data.licence_number ?? null : null, qualification: t === "installer" ? data.qualification ?? null : null,
      added_by: inv.created_by, approval_status: "pending",
      // Installer certificate metadata: uploaded is NOT verified. Office verification sets certification_status='verified'.
      certification_status: t === "installer" ? "unverified" : null,
      certification: t === "installer" ? (mergeEec(null, eecUploadMeta(data.certificate_path!, now, data.certificate_number)) as never) : null,
    }).select("id").single();
    if (error) {
      await admin.from("partner_worker_invites").update({ used_at: null }).eq("id", inv.id);
      return { ok: false as const, errors: [error.code === "23505" ? "Someone with that email is already registered under this business." : "We couldn't save your details. Please try again."] };
    }
    await admin.from("partner_worker_invites").update({
      worker_id: w.id, signed_name: data.signed_name, signed_ip: context.ip, signed_user_agent: context.userAgent,
      declarations: { version: WORKER_DECLARATIONS_VERSION, accepted: decls, signed_at: now },
    }).eq("id", inv.id);
    return { ok: true as const };
  });
