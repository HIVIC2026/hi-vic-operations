// Part 2b: an installer boss adds an electrician of their own. Only the boss of an INSTALLER business can use this; the
// installer is always the caller's own business (never from the client). A match on an already-approved electrician only
// switches on the installer's link (no re-upload); otherwise a pending electrician business is created for the office to
// approve, with clean-up if any step fails. The three Part 2b columns on businesses are pending SQL: until it is applied
// the add refuses ("This feature isn't switched on yet.") before writing anything.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { bossOrThrow } from "./trade-view.server";
import { normaliseLicence } from "./our-lead-piesa-electrician.core";
import { sameWorkerEmail } from "./worker-role.core";
import { isMissingDbObject } from "./schema-compat.core";
import { allowedUpload } from "./upload-safety.core";
import { melbourneToday } from "./worker-compliance.core";
import { addElectricianProblems, type AddElectricianInput } from "./my-electricians.core";

export const NOT_SWITCHED_ON = "This feature isn't switched on yet.";
const BUCKET = "job-files";
const prefixFor = (installerId: string) => `partners/${installerId}/electrician-uploads/`;

async function installerBoss(userId: string) {
  const c = await bossOrThrow(userId);
  if (c.kind !== "installer") throw new WorkflowError("Only an installer's business owner can add electricians.");
  return c;
}

/** Fail closed: the new columns must exist before anything is written. */
async function requireColumns() {
  const { error } = await admin.from("businesses").select("id, added_by_installer_business_id, workcover_exempt_declared_at, installer_added_rejected_reason").limit(1);
  if (error) { if (isMissingDbObject(error)) throw new WorkflowError(NOT_SWITCHED_ON); throw new WorkflowError("Could not check this just now. Please try again."); }
}

export async function myElectricianUploadUrl(userId: string, kind: "licence" | "pl" | "workcover", fileName: string): Promise<{ path: string; signedUrl: string }> {
  const c = await installerBoss(userId);
  if (!allowedUpload(fileName, null)) throw new WorkflowError("That file type isn't accepted. Please upload a PDF or a photo.");
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const path = `${prefixFor(c.biz.id)}${crypto.randomUUID()}-${kind}-${safe}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) throw new WorkflowError("Could not start the upload. Please try again.");
  return { path, signedUrl: data.signedUrl };
}

type BizRow = { id: string; business_type: string | null; capabilities: string[] | null; onboarding_status: string | null; is_active: boolean | null; added_by_installer_business_id: string | null };
type WorkerRow = { id: string; business_id: string; email: string | null; licence_number: string | null; approval_status: string };

/** Every live electrician person whose licence or email is this one (keyset-paged, never the 1000-row cap). */
async function matchingWorkers(licence: string, email: string): Promise<WorkerRow[]> {
  const want = normaliseLicence(licence); const out: WorkerRow[] = []; let last = "";
  for (;;) {
    let q = admin.from("partner_workers").select("id, business_id, email, licence_number, approval_status").eq("trade_role", "electrician").is("removed_at", null).order("id").limit(1000);
    if (last) q = q.gt("id", last);
    const { data, error } = await q;
    if (error) throw new WorkflowError("Could not check your electrician against the list. Please try again.");
    const rows = (data ?? []) as WorkerRow[];
    for (const w of rows) if ((want && normaliseLicence(w.licence_number) === want) || sameWorkerEmail(w.email, email)) out.push(w);
    if (rows.length < 1000) return out;
    last = rows[rows.length - 1]!.id;
  }
}

export async function installerAddElectrician(userId: string, input: AddElectricianInput): Promise<{ result: "added" | "linked"; businessId: string }> {
  const c = await installerBoss(userId);
  const installerId = c.biz.id;
  const problems = addElectricianProblems(input, melbourneToday());
  if (problems.length) throw new WorkflowError(problems.join(". "));
  const prefix = prefixFor(installerId);
  const paths = [input.licenceFilePath, input.plFilePath, input.employsAnyone ? input.workcoverFilePath : null].filter((p): p is string => !!p);
  for (const p of paths) {
    if (!p.startsWith(prefix) || p.includes("..")) throw new WorkflowError("That file doesn't belong to your business. Please upload it again.");
    if (!allowedUpload(p, null)) throw new WorkflowError("That file type isn't accepted. Please upload a PDF or a photo.");
  }
  await requireColumns();

  // Who is this already?
  const workers = await matchingWorkers(input.licenceNumber, input.email);
  if (workers.length) {
    const ids = [...new Set(workers.map((w) => w.business_id))];
    // The added-by column is pending SQL and not in the generated types yet; requireColumns() above proved it exists.
    const res = (await admin.from("businesses").select("id, business_type, capabilities, onboarding_status, is_active, added_by_installer_business_id").in("id", ids)) as unknown as { data: BizRow[] | null; error: unknown };
    const bizs = res.data; const error = res.error;
    if (error) throw new WorkflowError("Could not check your electrician against the list. Please try again.");
    const elec = (bizs ?? []).filter((b) => b.business_type === "rec" || (b.capabilities ?? []).includes("electrician"));
    if (elec.length) {
      const approved = elec.find((b) => b.onboarding_status === "approved" && b.is_active !== false && workers.some((w) => w.business_id === b.id && w.approval_status === "approved"));
      const target = approved ?? elec[0]!;
      const { data: rel, error: re } = await admin.from("partner_relationships").select("id, active").eq("installer_business_id", installerId).eq("electrician_business_id", target.id).maybeSingle();
      if (re) throw new WorkflowError("Could not check your list. Please try again.");
      if (approved) {
        if (rel?.active) throw new WorkflowError("Already on your list");
        const { error: ue } = await admin.from("partner_relationships").upsert({ installer_business_id: installerId, electrician_business_id: approved.id, active: true, ...(rel ? {} : { source: "installer_added", created_by: userId }) } as never, { onConflict: "installer_business_id,electrician_business_id" });
        if (ue) throw new WorkflowError("Could not add them to your list. Please try again.");
        await logAdd(userId, installerId, approved.id, "linked", input.name);
        return { result: "linked", businessId: approved.id };
      }
      if (rel || target.added_by_installer_business_id === installerId) throw new WorkflowError("Already on your list");
      throw new WorkflowError("This electrician is already waiting for approval");
    }
  }

  // New electrician. Files are checked first so a bad file creates nothing.
  const { verifyStoredUpload } = await import("./upload-safety.server");
  for (const p of paths) await verifyStoredUpload(BUCKET, p, allowedUpload(p, null)!);

  const now = new Date().toISOString();
  const made: { businessId?: string; workerId?: string; relId?: string; credIds: string[] } = { credIds: [] };
  try {
    const b = await admin.from("businesses").insert({
      business_type: "rec", capabilities: ["electrician"], name: input.name.trim(), email: input.email.trim(), phone: input.mobile.trim(), rec_number: input.recNumber.trim(),
      onboarding_status: "submitted", is_active: false, public_liability_cover_amount: input.plAmount, added_by_installer_business_id: installerId,
      workcover_exempt_declared_at: input.employsAnyone ? null : now,
    } as never).select("id").single();
    if (b.error || !b.data) throw new Error(b.error?.message ?? "business");
    made.businessId = (b.data as { id: string }).id;
    const bid = made.businessId;
    const w = await admin.from("partner_workers").insert({
      business_id: bid, trade_role: "electrician", full_legal_name: input.name.trim(), email: input.email.trim(), mobile: input.mobile.trim(), rec_number: input.recNumber.trim(),
      licence_number: input.licenceNumber.trim(), licence_expires_on: input.licenceExpiry, approval_status: "pending", added_by: userId,
    } as never).select("id").single();
    if (w.error || !w.data) throw new Error(w.error?.message ?? "worker");
    made.workerId = (w.data as { id: string }).id;
    const cred = (kind: string, label: string, number: string | null, expires: string | null, file: string | null) => ({ business_id: bid, kind, label, number, expires_at: expires, document_path: file, verification: "pending", critical: true, created_by: userId });
    const creds = [
      cred("electrical_licence", "Electrical licence", input.licenceNumber.trim(), input.licenceExpiry, input.licenceFilePath),
      cred("rec_registration", "REC registration", input.recNumber.trim(), null, null),
      cred("public_liability_insurance", `Public liability insurance ($${Math.round(input.plAmount).toLocaleString("en-AU")} cover)`, null, input.plExpiry, input.plFilePath),
      ...(input.employsAnyone ? [cred("workers_comp_insurance", "WorkCover", null, input.workcoverExpiry ?? null, input.workcoverFilePath ?? null)] : []),
    ];
    for (const row of creds) {
      const r = await admin.from("business_credentials").insert(row as never).select("id").single();
      if (r.error || !r.data) throw new Error(r.error?.message ?? "credential");
      made.credIds.push((r.data as { id: string }).id);
    }
    const rel = await admin.from("partner_relationships").insert({ installer_business_id: installerId, electrician_business_id: bid, active: false, source: "installer_added", created_by: userId } as never).select("id").single();
    if (rel.error || !rel.data) throw new Error(rel.error?.message ?? "link");
    made.relId = (rel.data as { id: string }).id;
    await logAdd(userId, installerId, bid, "added", input.name);
    return { result: "added", businessId: bid };
  } catch (e) {
    // Clean up in reverse order; each step is best-effort so one failure doesn't stop the rest.
    if (made.relId) await admin.from("partner_relationships").delete().eq("id", made.relId);
    if (made.credIds.length) await admin.from("business_credentials").delete().in("id", made.credIds);
    if (made.workerId) await admin.from("partner_workers").delete().eq("id", made.workerId);
    if (made.businessId) await admin.from("businesses").delete().eq("id", made.businessId);
    console.error("installerAddElectrician failed and was cleaned up", (e as Error).message);
    throw new WorkflowError("Could not add the electrician. Nothing was saved. Please try again.");
  }
}

async function logAdd(actorId: string, installerId: string, electricianId: string, result: "added" | "linked", name: string) {
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "installer_added_electrician", summary: `Installer ${result === "linked" ? "linked" : "added"} electrician ${name.trim()}`, details: { installer_business_id: installerId, electrician_business_id: electricianId, result } });
  if (error) console.error("installer_added_electrician event not logged", error.message);
}
