// RPC for the slim bulk installer import. Installer members upload for their own approved business;
// the office can upload on behalf of any approved installer business. Nothing is sent to customers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { myBusinesses, requireApprovedPartner, requireMember } from "./pilot.server";
import { WorkflowError } from "./workflow.server";
import { CONTACT_PERMISSION_WORDING } from "./bulk-import.core";
import type { Json } from "@/integrations/supabase/types";
import { hashToken, newToken } from "./worker-links.core";
import { allBulkRows, bulkBatchAccess, bulkBusinessAccess, bulkRowAccess, bulkRpc, checkedBulk } from "./bulk-import-access.server";
import { bulkCounts, type BulkCounts } from "./bulk-import.core";

const uuid = z.string().uuid();
const rawRow = z.record(z.string(), z.string());
const manifestFile = z.object({
  path: z.string().max(1000), name: z.string().max(300), folder: z.string().max(500).nullable().optional(),
  type: z.string().max(100).nullable().optional(),
  gps_lat: z.number().nullable().optional(), gps_lng: z.number().nullable().optional(),
  taken_at: z.string().max(60).nullable().optional(),
  geo_address: z.string().max(300).nullable().optional(),
  stored_path: z.string().max(500).optional(), // private copy in job-files (partners/<business>/imports/…), attached on confirm
});
const fileRead = z.object({ name: z.string().max(1000), status: z.enum(["ok", "warn", "error"]), message: z.string().max(500) });

async function canUseBulkImport(userId: string, businessId: string, onBehalf: boolean) {
  const { isAdmin } = await bulkBusinessAccess(userId,businessId,true);
  if (onBehalf) {
    if (!isAdmin) throw new WorkflowError("Only the office can upload on behalf of an installer.");
  } else {
    await requireMember(userId, businessId, true); // boss only (matches route-guards INSTALLER_BOSS_ONLY)
  }
  return !!isAdmin;
}

export const createBulkBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid,
    onBehalf: z.boolean().default(false),
    listFilename: z.string().min(1).max(300),
    rawRows: z.array(rawRow).max(5000).default([]),
    documents: z.array(z.object({ name: z.string().max(300), text: z.string().max(200_000) })).max(500).default([]),
    // Optional since 7 Oct: consent is now ticked per customer on the review card (enforced at confirm).
    permissionConfirmed: z.boolean().optional(),
    manifest: z.array(manifestFile).max(5000).default([]),
    fileReads: z.array(fileRead).max(5000).default([]),
    // Leads the page already read chunk by chunk (big lists). Still cleaned and checked like any AI reading.
    preExtracted: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { data: batch, error } = await admin.from("bulk_import_batches").insert({
      business_id: data.businessId, created_by: context.userId, on_behalf: data.onBehalf,
      list_filename: data.listFilename, file_manifest: data.manifest as unknown as Json,
      summary: {
        raw_rows: data.rawRows, documents: data.documents, file_reads: data.fileReads,
        ...(data.preExtracted ? { pre_extracted: data.preExtracted } : {}),
        permission: data.permissionConfirmed ? { confirmed_by: context.userId, confirmed_at: new Date().toISOString(), wording: CONTACT_PERMISSION_WORDING } : null,
      } as unknown as Json,
    }).select("id").single();
    if (error || !batch) throw new WorkflowError(error?.message ?? "Upload could not be saved.");
    const { logPartner } = await import("./pilot.server");
    if (data.permissionConfirmed) await logPartner(null, context.userId, "bulk_import_permission", CONTACT_PERMISSION_WORDING, { batch_id: batch.id, confirmed_by: context.userId });
    const { analyseBatch } = await import("./bulk-import.server");
    const summary = await analyseBatch(batch.id, context.userId);
    return { batchId: batch.id, summary };
  });

export const bulkBatchReview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batchId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { batch, isAdmin } = await bulkBatchAccess(data.batchId,context.userId);
    const rows = await allBulkRows(data.batchId);
    const biz = checkedBulk(await admin.from("businesses").select("name").eq("id", batch.business_id).single(), "Could not read the upload business");
    return { batch, rows, counts: bulkCounts(rows as unknown as { status: string; job_id: string | null }[]), businessName: biz?.name ?? "", isAdmin };
  });

export const confirmBulkBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    batchId: uuid, skipRowIds: z.array(uuid).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await bulkBatchAccess(data.batchId,context.userId,true);
    const { confirmBatch } = await import("./bulk-import.server");
    return confirmBatch(data.batchId, context.userId, data.skipRowIds);
  });

const electricianPlan = z.object({ mode: z.enum(["mine", "hivic", "job_by_job"]), nomination_id: uuid.nullable().optional(), business_id: uuid.nullable().optional() });
export const setBulkReviewPlan = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batchId: uuid, batchPlan: electricianPlan, rows: z.array(z.object({ rowId: uuid, stage: z.enum(["not_visited", "visited", "quoted", "installed"]), plan: electricianPlan.nullable(),
    siteCheck: z.enum(["yes", "no"]).nullable().optional(), siteCheckDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    quoted: z.enum(["yes", "no"]).nullable().optional(), quotedPrice: z.number().positive().max(1_000_000).nullable().optional(), consent: z.boolean().optional() })).max(5000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { batch } = await bulkBatchAccess(data.batchId,context.userId,true);
    if (!batch || batch.status !== "analysed") throw new WorkflowError("This upload can no longer be changed.");
    await bulkRpc("set_bulk_import_plan", { _batch: data.batchId, _actor: context.userId, _plan: data.batchPlan });
    const { stageForSiteCheck, quotedGap, quotedPrice } = await import("./bulk-import.core");
    const existing = await allBulkRows(data.batchId);
    const lockedRows: number[] = [];
    const byId = new Map((existing ?? []).map((r) => [r.id, r]));
    for (const row of data.rows) {
      const cur = byId.get(row.rowId);
      if (!cur) continue;
      if (cur.status !== "pending") continue; // confirmed/skipped history is never rewritten during a partial retry
      // A job was already started for this customer: its answers are locked (corrections go via the job page).
      if (cur.job_id) { lockedRows.push(Number(cur.row_index) + 1); continue; }
      const e = { ...(cur.extracted ?? {}) as Record<string, unknown> };
      // Site check answered on the review screen (Jo, 7 Oct): Yes skips the Ready Check, No goes to it.
      const answered = row.siteCheck !== undefined && row.siteCheck !== (e["site_check"] ?? null);
      const check = row.siteCheck !== undefined ? row.siteCheck : (e["site_check"] as "yes" | "no" | null) ?? null;
      const date = check === "yes" ? (row.siteCheckDate !== undefined ? row.siteCheckDate : (e["site_check_date"] as string | null) ?? null) : null;
      // "Quoted? Yes / No" (Jo, 7 Oct): only a complete answer is stored; Yes keeps the price exactly, No clears it.
      const q = row.quoted !== undefined && row.quoted !== null && !quotedGap(row.quoted, row.quotedPrice) ? row.quoted : (e["quoted_answer"] as "yes" | "no" | null) ?? null;
      if (row.quoted !== undefined && row.quoted !== null && q === row.quoted) e["price_inc_gst"] = quotedPrice(row.quoted, row.quotedPrice);
      if (row.quoted === null) e["quoted_answer"] = null;
      else e["quoted_answer"] = q;
      const priced = Number(e["price_inc_gst"] ?? 0) > 0;
      const stage = row.stage === "installed" ? "installed" : stageForSiteCheck(check, priced, cur.import_stage as never);
      await bulkRpc("edit_bulk_import_row", { _row: row.rowId, _actor: context.userId, _expected: { extracted: cur.extracted, job_id: null, status: "pending" }, _patch: {
        import_stage: stage, electrician_plan: row.plan as unknown as Json,
        extracted: { ...e, ...(row.consent === undefined ? {} : { owner_consent: row.consent ? { confirmed_by: context.userId, confirmed_at: new Date().toISOString(), wording: CONTACT_PERMISSION_WORDING } : false }), site_check: check, site_check_date: date, site_check_source: answered ? "asked" : e["site_check_source"] ?? null, lead_stage: stage } as unknown as Json,
      } });
    }
    return { ok: true, lockedRows };
  });

export const bulkElectricianChoices = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, data.businessId, true);
    const [{ data: rels }, { data: nominations }] = await Promise.all([
      admin.from("partner_relationships").select("electrician_business_id,is_primary,businesses!partner_relationships_electrician_business_id_fkey(name,trading_name,onboarding_status)").eq("installer_business_id", data.businessId).eq("active", true),
      admin.from("electrician_nominations").select("id,contact_name,business_name,status,business_id").eq("nominating_business_id", data.businessId).is("job_id", null).is("ended_at", null).order("created_at", { ascending: false }),
    ]);
    return { approved: (rels ?? []).map((r) => ({ businessId: r.electrician_business_id, primary: r.is_primary, name: (r.businesses as { trading_name?: string | null; name?: string } | null)?.trading_name || (r.businesses as { name?: string } | null)?.name || "Your electrician", status: "Already signed up ✓" })), pending: (nominations ?? []).filter((n) => !n.business_id).map((n) => ({ nominationId: n.id, name: n.contact_name, business: n.business_name, status: n.status })) };
  });

export const addBulkElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, name: z.string().trim().min(2).max(200), mobile: z.string().trim().min(8).max(40), email: z.string().trim().email("Add their email").max(320), business: z.string().trim().min(2, "Add their business").max(200), dryRun: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context.userId, data.businessId, true);
    const mobile = data.mobile.replace(/\D/g, "");
    let ownQuery = admin.from("electrician_nominations").select("id,contact_name,business_id,status,invite_sent_at,invite_link_issued_at,email").eq("nominating_business_id", data.businessId).is("job_id", null).is("ended_at", null);
    ownQuery = data.email ? ownQuery.or(`phone.eq.${mobile},email.ilike.${data.email.replace(/[%_,]/g, "")}`) : ownQuery.eq("phone", mobile);
    const { data: own, error: ownError } = await ownQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ownError) throw new WorkflowError("Couldn't check the electrician. Your details are still here; please try again.");
    if (own) {
      if (own.business_id) return { nominationId: own.id, businessId: own.business_id, name: own.contact_name, status: "Already signed up ✓" };
      const { data: attempts, error: attemptError } = await admin.from("admin_config_events").select("id").eq("event_type", "office_manual_email").contains("details", { nominationId: own.id, label: "electrician_invite" }).limit(1);
      if (attemptError) throw new WorkflowError("Invitation delivery could not be checked. Nothing was sent.");
      const { existingElectricianInviteBlocker } = await import("./job-electrician.core");
      const blocked = existingElectricianInviteBlocker({ status: own.status, sentAt: own.invite_sent_at, issuedAt: own.invite_link_issued_at, attempted: !!attempts?.length });
      if (blocked) throw new WorkflowError(blocked);
      if (own.email?.trim().toLowerCase() !== data.email.trim().toLowerCase()) throw new WorkflowError("This mobile is already linked to different electrician details. Ask the office to check them; nothing was sent.");
      const invite = newToken();
      const { data: claimed, error: claimError } = await admin.from("electrician_nominations").update({ invite_link_issued_at: new Date().toISOString(), invite_token_hash: await hashToken(invite), invite_expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString() }).eq("id", own.id).eq("nominating_business_id", data.businessId).eq("status", "invite_pending_comms").is("invite_sent_at", null).is("invite_link_issued_at", null).select("id").maybeSingle();
      if (claimError || !claimed) throw new WorkflowError("Invitation is being checked or sent. Ask the office to check delivery before trying again.");
      const sent = await (await import("./job-electrician-invite.server")).sendElectricianInvite({ actorId: context.userId, nominationId: own.id, installerBusinessId: data.businessId, inviteToken: invite, to: data.email, name: own.contact_name, dryRun: data.dryRun === true });
      return { nominationId: own.id, businessId: null, name: own.contact_name, status: sent.status === "sent" ? "Electrician invited – waiting to onboard" : "Electrician added – invitation delivery not confirmed", invite: { status: sent.status, to: sent.to } };
    }
    let matchQuery = admin.from("businesses").select("id").eq("onboarding_status", "approved");
    matchQuery = data.email ? matchQuery.or(`phone.eq.${mobile},email.ilike.${data.email.replace(/[%_,]/g, "")}`) : matchQuery.eq("phone", mobile);
    const { data: matched } = await matchQuery.limit(1).maybeSingle();
    const invite = newToken();
    const { data: nomination, error } = await admin.from("electrician_nominations").insert({
      contact_name: data.name, phone: mobile, email: data.email ?? null, business_name: data.business ?? null,
      nominating_business_id: data.businessId, nominated_by: context.userId, nominated_for: "installer",
      business_id: matched?.id ?? null, status: matched?.id ? "approved" : "invite_pending_comms", invite_link_issued_at: matched?.id ? null : new Date().toISOString(),
      invite_token_hash: matched?.id ? null : await hashToken(invite), invite_expires_at: matched?.id ? null : new Date(Date.now() + 14 * 86_400_000).toISOString(),
    }).select("id").single();
    if (error || !nomination) throw new WorkflowError("That electrician could not be added.");
    // Jo (7 Oct): email them the electrician application link straight away (manual partner email rule).
    const sent = matched?.id ? null : await (await import("./job-electrician-invite.server")).sendElectricianInvite({ actorId: context.userId, nominationId: nomination.id, installerBusinessId: data.businessId, inviteToken: invite, to: data.email, name: data.name, dryRun: data.dryRun === true });
    return { nominationId: nomination.id, businessId: matched?.id ?? null, name: data.name, status: matched?.id ? "Already signed up ✓" : sent?.status === "sent" ? "Electrician invited – waiting to onboard" : "Electrician added – invitation delivery not confirmed", invite: sent ? { status: sent.status, to: sent.to } : null };
  });

export const setBulkRowAddress = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    rowId: uuid,
    full_name: z.string().trim().min(2, "Enter the customer's name").max(200),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(320),
    phone: z.string().trim().min(8, "Enter a phone number").max(30),
    address_line: z.string().trim().min(3).max(200),
    suburb: z.string().trim().min(2, "Enter the suburb").max(100),
    postcode: z.string().trim().regex(/^3\d{3}$/, "Enter a 4-digit Victorian postcode"),
    second_contact: z.object({ name: z.string().trim().max(200).nullable(), phone: z.string().trim().max(30).nullable(), email: z.string().trim().max(320).nullable() }).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await bulkRowAccess(data.rowId,context.userId,true);
    const { setRowAddress } = await import("./bulk-import.server");
    return setRowAddress(data.rowId, { full_name: data.full_name, email: data.email, phone: data.phone, address_line: data.address_line, suburb: data.suburb, postcode: data.postcode, second_contact: data.second_contact ?? null }, context.userId);
  });

export const listBulkBatches = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const isAdmin = checkedBulk(await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" }), "Could not verify Office access") === true;
    let query = admin.from("bulk_import_batches").select("id,business_id,status,list_filename,summary,created_at,on_behalf").neq("status", "discarded").order("created_at", { ascending: false }).limit(50);
    if (data.businessId) {
      await bulkBusinessAccess(context.userId,data.businessId);
      query = query.eq("business_id",data.businessId);
    } else if (!isAdmin) {
      const members = checkedBulk(await admin.from("business_members").select("business_id").eq("user_id",context.userId).eq("active",true).eq("member_role","business_admin"), "Could not read your business memberships") ?? [];
      if (!members.length) return { batches: [], isAdmin };
      query = query.in("business_id",members.map(m => m.business_id));
    }
    const batches = checkedBulk(await query,"Could not read previous uploads") ?? [];
    const counts = batches.length ? await bulkRpc<Record<string,BulkCounts>>("bulk_import_batch_counts", { _batches: batches.map(b => b.id), _actor: context.userId }) : {};
    return { batches: batches.map(b => {
      if (!counts[b.id]) throw new WorkflowError("The upload history counts could not be verified.");
      return { ...b, counts: counts[b.id]! };
    }), isAdmin };
  });

/** Approved installer businesses for the office "on behalf" picker. */
export const bulkImportBusinesses = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) {
      const biz = await myBusinesses(context.userId);
      const out = [];
      for (const [id] of biz) {
        const { data: b } = await admin.from("businesses").select("id, name").eq("id", id).single();
        if (b) out.push(b);
      }
      return { businesses: out, isAdmin: false };
    }
    const { data: bizList } = await admin.from("businesses").select("id, name").eq("business_type", "eec_installer").eq("onboarding_status", "approved").order("name");
    return { businesses: bizList ?? [], isAdmin: true };
  });

/** AI reading of one uploaded PDF/photo (text or scanned) for the bulk upload. Nothing is stored or sent. */
/** Reads one chunk (up to 40 rows) of a big customer list. The page calls this per chunk to show progress and retry. */
export const readBulkRows = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, onBehalf: z.boolean().default(false), rows: z.array(rawRow).min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { aiExtractRows } = await import("./bulk-import.server");
    return { leads: await aiExtractRows(data.rows) };
  });

export const readBulkFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, onBehalf: z.boolean().default(false), name: z.string().min(1).max(1000),
    mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    base64: z.string().min(1).max(14_000_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { aiReadMedia } = await import("./bulk-import.server");
    const text = await aiReadMedia(data.name, data.mime, data.base64);
    return { text: /^NONE\b/i.test(text) ? "" : text, description: /^NONE\b/i.test(text) ? text.replace(/^NONE\W*/i, "").slice(0, 120) : "" };
  });

/** Approximate street address for photo GPS points (matching only, never evidence). */
export const geocodeBulkPhotos = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, onBehalf: z.boolean().default(false),
    points: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).max(40),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { reverseGeocode } = await import("./bulk-import.server");
    return { addresses: await reverseGeocode(data.points) };
  });

async function rowBusiness(rowId: string, userId: string) {
  const { batch } = await bulkRowAccess(rowId,userId,true);
  return batch.business_id;
}
export const addBulkRowFiles = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: uuid, files: z.array(z.object({ path: z.string().max(500), name: z.string().max(200), type: z.string().max(100) })).min(1).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const biz = await rowBusiness(data.rowId, context.userId);
    const { addRowFiles } = await import("./bulk-import.server");
    return addRowFiles(data.rowId, biz, data.files, context.userId);
  });
export const removeBulkRowFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: uuid, path: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await rowBusiness(data.rowId, context.userId);
    const { removeRowFile } = await import("./bulk-import.server");
    return removeRowFile(data.rowId, data.path, context.userId);
  });


/** Preview uses the row's original identity and its authorized manifest mapping, including closed history. */
export const bulkImportFileUrl = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: uuid, originalPath: z.string().min(1).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { bulkFilePreview } = await import("./bulk-import-access.server");
    return bulkFilePreview(data.rowId,data.originalPath,context.userId);
  });

/** An explicit Office action; it appends repair records and never reopens the completed batch. */
export const repairBulkImportFiles = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { repairConfirmedBulkFiles } = await import("./bulk-import-commit.server");
    return repairConfirmedBulkFiles(data.rowId,context.userId);
  });
