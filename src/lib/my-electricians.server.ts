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
import { addElectricianProblems, myElectricianStatus, type AddElectricianInput } from "./my-electricians.core";
import { stableUuid } from "./mitti-create-claim.core";
import { TEST_PARTNER_MARK, isTestPartner, normaliseAuMobile } from "./test-send.core";

const realDate = (d: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? ""); if (!m) return false; const t = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)); return t.getUTCFullYear() === +m[1]! && t.getUTCMonth() === +m[2]! - 1 && t.getUTCDate() === +m[3]!; };
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

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

type BizRow = { onboarding_notes: string | null; workcover_exempt_declared_at: string | null; installer_added_rejected_reason: string | null; id: string; business_type: string | null; capabilities: string[] | null; onboarding_status: string | null; is_active: boolean | null; added_by_installer_business_id: string | null };
type WorkerRow = { licence_expires_on: string | null; id: string; business_id: string; email: string | null; licence_number: string | null; approval_status: string };

/** Every live electrician person whose licence or email is this one (keyset-paged, never the 1000-row cap). */
async function matchingWorkers(licence: string, email: string): Promise<WorkerRow[]> {
  const want = normaliseLicence(licence); const out: WorkerRow[] = []; let last = "";
  for (;;) {
    let q = admin.from("partner_workers").select("id, business_id, email, licence_number, licence_expires_on, approval_status").eq("trade_role", "electrician").is("removed_at", null).order("id").limit(1000);
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
  const shape: string[] = [];
  if (input.email.trim() && !validEmail(input.email)) shape.push("Enter a valid email");
  if (input.mobile.trim() && !normaliseAuMobile(input.mobile)) shape.push("Enter a valid Australian mobile");
  for (const d of [input.licenceExpiry, input.plExpiry, input.employsAnyone ? input.workcoverExpiry : null]) if (d && !realDate(d)) { shape.push("Enter a real date"); break; }
  if (shape.length) throw new WorkflowError(shape.join(". "));
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
  const testSide = isTestPartner(c.biz);
  const workers = await matchingWorkers(input.licenceNumber, input.email);
  if (workers.length) {
    const ids = [...new Set(workers.map((w) => w.business_id))];
    // The added-by columns are pending SQL and not in the generated types yet; requireColumns() above proved they exist.
    const res = (await admin.from("businesses").select("id, business_type, capabilities, onboarding_status, is_active, onboarding_notes, added_by_installer_business_id, workcover_exempt_declared_at, installer_added_rejected_reason").in("id", ids)) as unknown as { data: BizRow[] | null; error: unknown };
    if (res.error) throw new WorkflowError("Could not check your electrician against the list. Please try again.");
    // TEST electricians are only ever matched by TEST installers, and real ones by real installers.
    const elec = (res.data ?? []).filter((b) => (b.business_type === "rec" || (b.capabilities ?? []).includes("electrician")) && isTestPartner(b) === testSide);
    if (elec.length) {
      const graded = [];
      for (const b of elec) graded.push({ b, g: await gradeMatch(b, workers.filter((w) => w.business_id === b.id)) });
      const hit = graded.find((x) => x.g.state === "approved") ?? graded[0]!;
      await decideMatch(userId, installerId, hit.b, hit.g, input.name);
      return { result: "linked", businessId: hit.b.id };
    }
  }

  // New electrician. Files are checked first so a bad file creates nothing.
  const { verifyStoredUpload } = await import("./upload-safety.server");
  for (const p of paths) await verifyStoredUpload(BUCKET, p, allowedUpload(p, null)!);

  const now = new Date().toISOString();
  const licenceKey = normaliseLicence(input.licenceNumber);
  if (!licenceKey) throw new WorkflowError("Enter a valid licence number");
  // Same electrician = same id, whoever adds them, so a second concurrent add fails on the primary key instead of duplicating.
  const newId = await stableUuid(`my-electrician:${testSide ? "test" : "real"}:${licenceKey}`);
  let lostRace: string | null = null;
  const made: { businessId?: string; workerId?: string; relId?: string; credIds: string[] } = { credIds: [] };
  try {
    const b = await admin.from("businesses").insert({
      id: newId, business_type: "rec", capabilities: ["electrician"], name: input.name.trim(), email: input.email.trim(), phone: normaliseAuMobile(input.mobile) ?? input.mobile.trim(), rec_number: input.recNumber.trim(),
      onboarding_status: "submitted", is_active: false, public_liability_cover_amount: input.plAmount, added_by_installer_business_id: installerId,
      workcover_exempt_declared_at: input.employsAnyone ? null : now,
      ...(testSide ? { onboarding_notes: TEST_PARTNER_MARK } : {}),
    } as never).select("id").single();
    if (b.error && (b.error as { code?: string }).code === "23505") {
      // Primary-key clash: nothing of ours exists, so there is nothing to clean up. Say "waiting" only if the existing row
      // really is a pending electrician with a live person matching this licence or email; anything else is neutral.
      const ex = (await admin.from("businesses").select("id, onboarding_status, installer_added_rejected_reason, added_by_installer_business_id").eq("id", newId).maybeSingle()) as unknown as { data: { onboarding_status: string | null; installer_added_rejected_reason: string | null; added_by_installer_business_id: string | null } | null };
      if (!ex.data) throw new Error("unique clash on another constraint"); // not our id: generic failure below
      const live = await matchingWorkers(input.licenceNumber, input.email).then((ws) => ws.some((w) => w.business_id === newId)).catch(() => false);
      const pending = ex.data.onboarding_status === "submitted" && !ex.data.installer_added_rejected_reason?.trim() && live;
      lostRace = !pending ? "This electrician can't be added right now — contact Home Insulation Victoria" : ex.data.added_by_installer_business_id === installerId ? "Already on your list" : "This electrician is already waiting for approval";
      throw new Error("lost race");
    }
    if (b.error || !b.data) throw new Error(b.error?.message ?? "business");
    made.businessId = (b.data as { id: string }).id;
    const bid = made.businessId;
    const w = await admin.from("partner_workers").insert({
      business_id: bid, trade_role: "electrician", full_legal_name: input.name.trim(), email: input.email.trim(), mobile: normaliseAuMobile(input.mobile) ?? input.mobile.trim(), rec_number: input.recNumber.trim(),
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
    if (lostRace) throw new WorkflowError(lostRace);
    // Clean up in reverse order, and only rows THIS call inserted. A failed delete is logged, never hidden.
    const del = async (table: "partner_relationships" | "business_credentials" | "partner_workers" | "businesses", col: "id", ids: string[]) => {
      const { error } = await admin.from(table).delete().in(col, ids);
      if (error) console.error(`installerAddElectrician clean-up of ${table} failed`, error.message);
    };
    if (made.relId) await del("partner_relationships", "id", [made.relId]);
    if (made.credIds.length) await del("business_credentials", "id", made.credIds);
    if (made.workerId) await del("partner_workers", "id", [made.workerId]);
    if (made.businessId) await del("businesses", "id", [made.businessId]);
    console.error("installerAddElectrician failed and was cleaned up", (e as Error).message);
    throw new WorkflowError("Could not add the electrician. Nothing was saved. Please try again.");
  }
}

type Grade = { state: "approved" | "waiting" | "not_approved" | "expired"; reason: string | null };

/** Work out where a matched electrician really stands: rejected, still waiting, lapsed paperwork, or good to link. */
async function gradeMatch(b: BizRow, ws: WorkerRow[]): Promise<Grade> {
  const reason = b.installer_added_rejected_reason?.trim() || null;
  const { data: creds, error } = await admin.from("business_credentials").select("kind, expires_at, verification").eq("business_id", b.id).in("kind", ["electrical_licence", "public_liability_insurance", "workers_comp_insurance"]);
  if (error) throw new WorkflowError("Could not check your electrician against the list. Please try again.");
  const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
  const latest = (kind: string) => (creds ?? []).filter((x) => x.kind === kind && x.verification !== "rejected").map((x) => day(x.expires_at)).filter((x): x is string => !!x).sort().pop() ?? null;
  const workerApproved = ws.some((w) => w.approval_status === "approved");
  const licence = ws.map((w) => day(w.licence_expires_on)).filter((x): x is string => !!x).sort().pop() ?? latest("electrical_licence");
  const st = myElectricianStatus({
    onboardingStatus: b.onboarding_status, workerApproval: workerApproved ? "approved" : "pending", rejectedReason: reason,
    licenceExpiry: licence, plExpiry: latest("public_liability_insurance"), workcoverExpiry: latest("workers_comp_insurance"),
    workcoverExempt: !!b.workcover_exempt_declared_at, today: melbourneToday(),
  });
  // Approved but switched off by the office counts as "can't link" with the same plain message as lapsed paperwork.
  if (st === "approved" && b.is_active === false) return { state: "expired", reason };
  return { state: st, reason };
}

/** Throws the right plain message, or activates the link (never for rejected, waiting or lapsed electricians). */
async function decideMatch(userId: string, installerId: string, b: BizRow, g: Grade, name: string) {
  const { data: rel, error: re } = await admin.from("partner_relationships").select("id, active").eq("installer_business_id", installerId).eq("electrician_business_id", b.id).maybeSingle();
  if (re) throw new WorkflowError("Could not check your list. Please try again.");
  const mine = !!rel || b.added_by_installer_business_id === installerId;
  if (g.state === "waiting") throw new WorkflowError(mine ? "Already on your list" : "This electrician is already waiting for approval");
  if (g.state === "not_approved") throw new WorkflowError(b.added_by_installer_business_id === installerId ? `Not approved: ${g.reason}. Fix it in My electricians.` : "This electrician can't be added right now — contact Home Insulation Victoria");
  if (g.state === "expired") throw new WorkflowError("Their paperwork has expired. Ask them to update it with Home Insulation Victoria.");
  if (rel?.active) throw new WorkflowError("Already on your list");
  const { error: ue } = await admin.from("partner_relationships").upsert({ installer_business_id: installerId, electrician_business_id: b.id, active: true, ...(rel ? {} : { source: "installer_added", created_by: userId }) } as never, { onConflict: "installer_business_id,electrician_business_id" });
  if (ue) throw new WorkflowError("Could not add them to your list. Please try again.");
  await logAdd(userId, installerId, b.id, "linked", name);
}

async function logAdd(actorId: string, installerId: string, electricianId: string, result: "added" | "linked", name: string) {
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "installer_added_electrician", summary: `Installer ${result === "linked" ? "linked" : "added"} electrician ${name.trim()}`, details: { installer_business_id: installerId, electrician_business_id: electricianId, result } });
  if (error) console.error("installer_added_electrician event not logged", error.message);
}
