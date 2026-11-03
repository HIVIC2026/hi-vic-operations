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
import { addElectricianProblems, approveChecklist, approveElectricianLine, myElectricianStatus, rejectionEmail, REJECTION_EMAIL_APPROVED, welcomeSmsKey, welcomeSmsText, type AddElectricianInput, type MyElectricianStatus } from "./my-electricians.core";
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

export async function myElectricianUploadUrl(userId: string, kind: "licence" | "pl" | "workcover", fileName: string): Promise<{ path: string; signedUrl: string; token: string }> {
  const c = await installerBoss(userId);
  if (!allowedUpload(fileName, null)) throw new WorkflowError("That file type isn't accepted. Please upload a PDF or a photo.");
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const path = `${prefixFor(c.biz.id)}${crypto.randomUUID()}-${kind}-${safe}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) throw new WorkflowError("Could not start the upload. Please try again.");
  return { path, signedUrl: data.signedUrl, token: data.token };
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

/** Shape, required answers and file ownership — the same for an add and a resubmit. Returns the file paths to verify. */
function checkInput(input: AddElectricianInput, installerId: string): string[] {
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
  return paths;
}

/** The credential rows an add or a resubmit writes for this input (all pending; the office verifies them on approval). */
function credentialRows(bid: string, input: AddElectricianInput, userId: string) {
  const cred = (kind: string, label: string, number: string | null, expires: string | null, file: string | null) => ({ business_id: bid, kind, label, number, expires_at: expires, document_path: file, verification: "pending", critical: true, created_by: userId });
  return [
    cred("electrical_licence", "Electrical licence", input.licenceNumber.trim(), input.licenceExpiry, input.licenceFilePath),
    cred("rec_registration", "REC registration", input.recNumber.trim(), null, null),
    cred("public_liability_insurance", `Public liability insurance ($${Math.round(input.plAmount).toLocaleString("en-AU")} cover)`, null, input.plExpiry, input.plFilePath),
    ...(input.employsAnyone ? [cred("workers_comp_insurance", "WorkCover", null, input.workcoverExpiry ?? null, input.workcoverFilePath ?? null)] : []),
  ];
}

export async function installerAddElectrician(userId: string, input: AddElectricianInput): Promise<{ result: "added" | "linked"; businessId: string }> {
  const c = await installerBoss(userId);
  const installerId = c.biz.id;
  const paths = checkInput(input, installerId);
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
    for (const row of credentialRows(bid, input, userId)) {
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
type CredRow = { kind: string; expires_at: unknown; verification: string | null };
const CRED_KINDS = ["electrical_licence", "public_liability_insurance", "workers_comp_insurance"];

/** Where an electrician stands from its rows: rejected, still waiting, lapsed paperwork, or approved. Shared by the add
 *  path (gradeMatch) and the installer's list so the two never disagree. */
function gradeRows(b: Pick<BizRow, "id" | "onboarding_status" | "is_active" | "installer_added_rejected_reason" | "workcover_exempt_declared_at">, ws: Pick<WorkerRow, "approval_status" | "licence_expires_on">[], creds: CredRow[], today: string): Grade & { licenceExpiry: string | null; plExpiry: string | null } {
  const reason = b.installer_added_rejected_reason?.trim() || null;
  const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
  const latest = (kind: string) => creds.filter((x) => x.kind === kind && x.verification !== "rejected").map((x) => day(x.expires_at)).filter((x): x is string => !!x).sort().pop() ?? null;
  const workerApproved = ws.some((w) => w.approval_status === "approved");
  const licence = ws.map((w) => day(w.licence_expires_on)).filter((x): x is string => !!x).sort().pop() ?? latest("electrical_licence");
  const plExpiry = latest("public_liability_insurance");
  const st = myElectricianStatus({
    onboardingStatus: b.onboarding_status, workerApproval: workerApproved ? "approved" : "pending", rejectedReason: reason,
    licenceExpiry: licence, plExpiry, workcoverExpiry: latest("workers_comp_insurance"),
    workcoverExempt: !!b.workcover_exempt_declared_at, today,
  });
  // Approved but switched off by the office counts as "can't use" with the same plain message as lapsed paperwork.
  const state = st === "approved" && b.is_active === false ? "expired" : st;
  return { state, reason, licenceExpiry: licence, plExpiry };
}

/** Work out where a matched electrician really stands: rejected, still waiting, lapsed paperwork, or good to link. */
async function gradeMatch(b: BizRow, ws: WorkerRow[]): Promise<Grade> {
  const { data: creds, error } = await admin.from("business_credentials").select("kind, expires_at, verification").eq("business_id", b.id).in("kind", CRED_KINDS);
  if (error) throw new WorkflowError("Could not check your electrician against the list. Please try again.");
  const { state, reason } = gradeRows(b, ws, (creds ?? []) as CredRow[], melbourneToday());
  return { state, reason };
}

export type MyElectricianRow = { id: string; name: string; status: MyElectricianStatus; reason: string | null; licenceExpiry: string | null; plExpiry: string | null };

/** The installer's "My electricians": every electrician linked to the caller's installer that is live (link active) or still
 *  on its way (waiting for approval, or not approved and fixable). A link the office switched off on an approved electrician
 *  is neither, so it is not shown. Sorted by name. */
export async function installerMyElectricians(userId: string): Promise<MyElectricianRow[]> {
  const c = await installerBoss(userId);
  await requireColumns();
  const fail = () => new WorkflowError("Could not load your electricians. Please try again.");
  const rels = await admin.from("partner_relationships").select("electrician_business_id, active").eq("installer_business_id", c.biz.id);
  if (rels.error) throw fail();
  const links = (rels.data ?? []) as { electrician_business_id: string; active: boolean }[];
  if (!links.length) return [];
  const ids = [...new Set(links.map((r) => r.electrician_business_id))];
  const [bz, ws, cr] = await Promise.all([
    admin.from("businesses").select("id, name, onboarding_status, is_active, installer_added_rejected_reason, workcover_exempt_declared_at").in("id", ids) as unknown as Promise<{ data: (Pick<BizRow, "id" | "onboarding_status" | "is_active" | "installer_added_rejected_reason" | "workcover_exempt_declared_at"> & { name: string | null })[] | null; error: unknown }>,
    admin.from("partner_workers").select("business_id, approval_status, licence_expires_on").in("business_id", ids).eq("trade_role", "electrician").is("removed_at", null),
    admin.from("business_credentials").select("business_id, kind, expires_at, verification").in("business_id", ids).in("kind", CRED_KINDS),
  ]);
  if (bz.error || ws.error || cr.error) throw fail();
  const today = melbourneToday();
  const out: MyElectricianRow[] = [];
  for (const b of bz.data ?? []) {
    const active = links.some((l) => l.electrician_business_id === b.id && l.active);
    const g = gradeRows(b, (ws.data ?? []).filter((w) => w.business_id === b.id) as WorkerRow[], ((cr.data ?? []) as (CredRow & { business_id: string })[]).filter((x) => x.business_id === b.id), today);
    if (!active && g.state !== "waiting" && g.state !== "not_approved") continue;
    out.push({ id: b.id, name: b.name?.trim() || "Electrician", status: g.state, reason: g.state === "not_approved" ? g.reason : null, licenceExpiry: g.licenceExpiry, plExpiry: g.plExpiry });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en-AU"));
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

// ---- Task 4: the office approves or rejects; the installer fixes and resubmits; Needs me item ----

type FullBiz = BizRow & { name: string | null; email: string | null; phone: string | null; rec_number: string | null; public_liability_cover_amount: number | string | null; approved_at: string | null };
type FullCred = CredRow & { id: string; document_path: string | null };
type Installer = { id: string; name: string | null; email: string | null; onboarding_notes: string | null };
const READ_FAIL = "Could not read this electrician just now. Please try again.";
const BIZ_COLS = "id, name, email, phone, rec_number, public_liability_cover_amount, business_type, capabilities, onboarding_status, is_active, approved_at, onboarding_notes, added_by_installer_business_id, workcover_exempt_declared_at, installer_added_rejected_reason";

/** The installer-added electrician's rows, or null when this business wasn't added by an installer. Columns pending → NOT_SWITCHED_ON. */
async function loadInstallerElectrician(businessId: string): Promise<{ biz: FullBiz; workers: WorkerRow[]; creds: FullCred[]; installer: Installer } | null> {
  await requireColumns();
  const b = (await admin.from("businesses").select(BIZ_COLS).eq("id", businessId).maybeSingle()) as unknown as { data: FullBiz | null; error: unknown };
  if (b.error) throw new WorkflowError(READ_FAIL);
  if (!b.data?.added_by_installer_business_id) return null;
  const [ws, cr, inst] = await Promise.all([
    admin.from("partner_workers").select("id, business_id, email, licence_number, licence_expires_on, approval_status").eq("business_id", businessId).eq("trade_role", "electrician").is("removed_at", null),
    admin.from("business_credentials").select("id, kind, expires_at, verification, document_path").eq("business_id", businessId).in("kind", [...CRED_KINDS, "rec_registration"]),
    admin.from("businesses").select("id, name, email, onboarding_notes").eq("id", b.data.added_by_installer_business_id).maybeSingle(),
  ]);
  if (ws.error || cr.error || inst.error || !inst.data) throw new WorkflowError(READ_FAIL);
  return { biz: b.data, workers: (ws.data ?? []) as WorkerRow[], creds: (cr.data ?? []) as FullCred[], installer: inst.data as Installer };
}

/** The office checklist from the rows: the LATEST non-rejected credential per kind counts (a resubmit supersedes the old one). */
function checklistProblems(biz: FullBiz, workers: WorkerRow[], creds: FullCred[], today: string): string[] {
  const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
  const live = (kind: string) => creds.filter((c) => c.kind === kind && c.verification !== "rejected");
  const latestExpiry = (kind: string) => live(kind).map((c) => day(c.expires_at)).filter((x): x is string => !!x).sort().pop() ?? null;
  const filePresent = (kind: string) => live(kind).some((c) => !!c.document_path);
  const licenceNumber = workers.map((w) => w.licence_number?.trim()).find((x) => !!x) ?? null;
  const plAmount = biz.public_liability_cover_amount;
  return approveChecklist({
    recNumber: biz.rec_number, licenceNumber, licenceExpiry: workers.map((w) => day(w.licence_expires_on)).filter((x): x is string => !!x).sort().pop() ?? latestExpiry("electrical_licence"), licenceFilePresent: filePresent("electrical_licence"),
    plAmount: plAmount == null ? null : Number(plAmount), plExpiry: latestExpiry("public_liability_insurance"), plFilePresent: filePresent("public_liability_insurance"),
    workcoverExpiry: latestExpiry("workers_comp_insurance"), workcoverFilePresent: filePresent("workers_comp_insurance"), workcoverExempt: !!biz.workcover_exempt_declared_at, today,
  });
}

export type InstallerElectricianReview = { name: string; installerId: string; installerName: string; status: MyElectricianStatus; rejectedReason: string | null; problems: string[] };

/** For the office business page: who added them, where they stand, and what (if anything) stops approval. Null = not installer-added. */
export async function installerElectricianReview(businessId: string): Promise<InstallerElectricianReview | null> {
  const r = await loadInstallerElectrician(businessId).catch((e: Error) => { if (e.message === NOT_SWITCHED_ON) return null; throw e; });
  if (!r) return null;
  const today = melbourneToday();
  const creds = (await admin.from("business_credentials").select("business_id, kind, expires_at, verification").eq("business_id", businessId).in("kind", CRED_KINDS)).data ?? [];
  const g = gradeRows(r.biz, r.workers, creds as CredRow[], today);
  return { name: r.biz.name?.trim() || "Electrician", installerId: r.installer.id, installerName: r.installer.name?.trim() || "an installer", status: g.state, rejectedReason: g.reason, problems: checklistProblems(r.biz, r.workers, r.creds, today) };
}

async function logOffice(actorId: string | null, eventType: string, summary: string, details: Record<string, unknown>) {
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: eventType, summary, details: details as never });
  if (error) console.error(`${eventType} event not logged`, error.message);
}

/**
 * Office approval of an installer-added electrician (admin only — the server function checks). The checklist is a hard
 * block with no override. Approval = credentials verified, business approved + active, the person approved (Mitti hook),
 * the installer's link switched ON (the installer's list hides inactive approved rows), ONE welcome text (held wording).
 * No agreement and no service areas are needed: they never get Home Insulation Victoria leads.
 */
export async function officeApproveInstallerElectrician(actorId: string, businessId: string): Promise<void> {
  const r = await loadInstallerElectrician(businessId);
  if (!r) throw new WorkflowError("This electrician wasn't added by an installer.");
  if (r.biz.onboarding_status === "approved") throw new WorkflowError("Already approved.");
  const problems = checklistProblems(r.biz, r.workers, r.creds, melbourneToday());
  if (problems.length) throw new WorkflowError(`Can't approve yet: ${problems.join(". ")}`);
  const now = new Date().toISOString();
  const fail = (what: string) => new WorkflowError(`Could not approve (${what}). Nothing else was changed. Please try again.`);
  const cv = await admin.from("business_credentials").update({ verification: "verified", verified_by: actorId, verified_at: now }).eq("business_id", businessId).eq("verification", "pending");
  if (cv.error) throw fail("paperwork");
  const bu = await admin.from("businesses").update({ onboarding_status: "approved", is_active: true, approved_by: actorId, approved_at: now, installer_added_rejected_reason: null, updated_at: now } as never).eq("id", businessId);
  if (bu.error) throw fail("business");
  const { approvePartnerWorker } = await import("./worker-approval.server");
  for (const w of r.workers.filter((x) => x.approval_status !== "approved")) await approvePartnerWorker(w.id, actorId, { kind: "office", reason: "Installer-added electrician approved by the office" });
  const rel = await admin.from("partner_relationships").upsert({ installer_business_id: r.installer.id, electrician_business_id: businessId, active: true, source: "installer_added", created_by: actorId } as never, { onConflict: "installer_business_id,electrician_business_id" });
  if (rel.error) throw new WorkflowError("Approved, but the installer's link could not be switched on. Link them from the installer's business file.");
  await logOffice(actorId, "installer_added_electrician_approved", `Approved installer-added electrician ${r.biz.name?.trim() ?? ""}`.trim(), { installer_business_id: r.installer.id, electrician_business_id: businessId });
  // Welcome text: stable key (once per electrician), pause check on the electrician with no job. Never fails the approval.
  try {
    const { sendRealSms } = await import("./sms.server");
    await sendRealSms({ type: "installer_added_electrician_welcome", idempotencyKey: welcomeSmsKey(businessId), to: r.biz.phone, businessId, jobId: null, event: { at: now }, body: welcomeSmsText({ electricianName: r.biz.name ?? "", installerName: r.installer.name ?? "your installer" }) });
  } catch (e) { console.error("installer-added electrician welcome text failed", (e as Error).message); }
}

/**
 * Office rejection (admin only — the server function checks). The business goes to needs_info with the reason (the
 * installer's list shows "Not approved: {reason}"), the link stays off, and the INSTALLER OFFICE is emailed — held for
 * real installers until Jo approves the wording (REJECTION_EMAIL_APPROVED); the hold is recorded, never silent.
 * `onboarding_status` has a database check (draft/submitted/needs_info/approved/suspended/expired): "rejected" is not a value it allows.
 */
export async function officeRejectInstallerElectrician(actorId: string, businessId: string, reason: string, opts: { approved?: boolean } = {}): Promise<void> {
  const why = reason.trim();
  if (!why) throw new WorkflowError("Give a reason for not approving them.");
  const r = await loadInstallerElectrician(businessId);
  if (!r) throw new WorkflowError("This electrician wasn't added by an installer.");
  if (r.biz.onboarding_status === "approved") throw new WorkflowError("Already approved.");
  const now = new Date().toISOString();
  const bu = await admin.from("businesses").update({ onboarding_status: "needs_info", is_active: false, installer_added_rejected_reason: why, updated_at: now } as never).eq("id", businessId);
  if (bu.error) throw new WorkflowError("Could not save this. Please try again.");
  const rel = await admin.from("partner_relationships").update({ active: false }).eq("installer_business_id", r.installer.id).eq("electrician_business_id", businessId);
  if (rel.error) console.error("installer-added electrician link not switched off", rel.error.message);
  const mail = rejectionEmail({ electricianName: r.biz.name ?? "", reason: why });
  const to = r.installer.email?.trim().toLowerCase() ?? "";
  const approved = opts.approved ?? REJECTION_EMAIL_APPROVED;
  let email: string;
  if (!to) email = "not sent: the installer has no email on file";
  else if (!approved && !isTestPartner(r.installer)) email = "held: wording not approved yet";
  else {
    const { sendOfficeEmail } = await import("./office-email.server");
    const sent = await sendOfficeEmail({ actorId, recipient: "partner", to, contactName: r.installer.name, subject: mail.subject, message: mail.message, label: `installer-added-electrician-rejected:${businessId}`, record: { businessId: r.installer.id }, pauseJobId: null })
      .catch((e: Error) => ({ status: "failed", detail: e.message }));
    email = `${sent.status}${sent.detail ? `: ${sent.detail}` : ""}`;
  }
  await logOffice(actorId, "installer_added_electrician_rejected", `Installer-added electrician ${r.biz.name?.trim() ?? ""} not approved: ${why}`.trim(), { installer_business_id: r.installer.id, electrician_business_id: businessId, reason: why, email });
}

/**
 * The installer that added a not-approved electrician fixes the details and documents and sends them back for approval.
 * Same checks as the add; old licence / insurance rows are marked rejected (never deleted) and fresh pending rows written.
 */
export async function installerResubmitElectrician(userId: string, businessId: string, input: AddElectricianInput): Promise<void> {
  const c = await installerBoss(userId);
  const paths = checkInput(input, c.biz.id);
  const r = await loadInstallerElectrician(businessId);
  if (!r || r.installer.id !== c.biz.id) throw new WorkflowError("This electrician isn't on your list.");
  if (r.biz.onboarding_status === "approved") throw new WorkflowError("They're already approved — nothing to resubmit.");
  if (!r.biz.installer_added_rejected_reason?.trim()) throw new WorkflowError("They're still waiting for approval — nothing to fix yet.");
  const { verifyStoredUpload } = await import("./upload-safety.server");
  for (const p of paths) await verifyStoredUpload(BUCKET, p, allowedUpload(p, null)!);
  const now = new Date().toISOString();
  const fail = () => new WorkflowError("Could not save the changes. Please try again.");
  const mobile = normaliseAuMobile(input.mobile) ?? input.mobile.trim();
  const bu = await admin.from("businesses").update({
    name: input.name.trim(), email: input.email.trim(), phone: mobile, rec_number: input.recNumber.trim(), public_liability_cover_amount: input.plAmount,
    onboarding_status: "submitted", installer_added_rejected_reason: null, workcover_exempt_declared_at: input.employsAnyone ? null : now, updated_at: now,
  } as never).eq("id", businessId);
  if (bu.error) throw fail();
  const wu = await admin.from("partner_workers").update({ full_legal_name: input.name.trim(), email: input.email.trim(), mobile, rec_number: input.recNumber.trim(), licence_number: input.licenceNumber.trim(), licence_expires_on: input.licenceExpiry } as never)
    .eq("business_id", businessId).eq("trade_role", "electrician").is("removed_at", null);
  if (wu.error) throw fail();
  const old = await admin.from("business_credentials").update({ verification: "rejected" }).eq("business_id", businessId).in("kind", [...CRED_KINDS, "rec_registration"]).neq("verification", "verified");
  if (old.error) throw fail();
  for (const row of credentialRows(businessId, input, userId)) {
    const { error } = await admin.from("business_credentials").insert(row as never);
    if (error) throw fail();
  }
  await logOffice(userId, "installer_added_electrician_resubmitted", `Installer resubmitted electrician ${input.name.trim()}`, { installer_business_id: c.biz.id, electrician_business_id: businessId });
}

export type PendingInstallerElectricianItem = { key: string; businessId: string; workerIds: string[]; who: string; line: string; since: string | null; href: string; isTest: boolean };

/** Needs me (partner fold): one item per installer-added electrician still waiting for the office. Columns pending → none. */
export async function pendingInstallerElectricianItems(): Promise<PendingInstallerElectricianItem[]> {
  const res = (await admin.from("businesses").select("id, name, onboarding_status, onboarding_notes, added_by_installer_business_id, installer_added_rejected_reason").not("added_by_installer_business_id", "is", null).eq("onboarding_status", "submitted")) as unknown as { data: (Pick<FullBiz, "id" | "name" | "onboarding_status" | "onboarding_notes" | "added_by_installer_business_id" | "installer_added_rejected_reason">)[] | null; error: { message: string; code?: string } | null };
  if (res.error) { if (isMissingDbObject(res.error)) return []; throw new Error(`Could not read electricians added by installers: ${res.error.message}`); }
  const waiting = (res.data ?? []).filter((b) => !b.installer_added_rejected_reason?.trim());
  if (!waiting.length) return [];
  const ids = waiting.map((b) => b.id);
  const [inst, ws, ev] = await Promise.all([
    admin.from("businesses").select("id, name").in("id", [...new Set(waiting.map((b) => b.added_by_installer_business_id!))]),
    admin.from("partner_workers").select("id, business_id").in("business_id", ids).eq("trade_role", "electrician").is("removed_at", null),
    admin.from("admin_config_events").select("created_at, details").in("event_type", ["installer_added_electrician", "installer_added_electrician_resubmitted"]).order("created_at", { ascending: false }),
  ]);
  if (inst.error || ws.error || ev.error) throw new Error("Could not read electricians added by installers.");
  const names = new Map((inst.data ?? []).map((b) => [b.id, b.name]));
  const since = new Map<string, string>();
  for (const e of (ev.data ?? []) as { created_at: string; details: { electrician_business_id?: string } | null }[]) { const bid = e.details?.electrician_business_id; if (bid && !since.has(bid)) since.set(bid, e.created_at); }
  return waiting.map((b) => ({
    key: `installer-electrician:${b.id}`, businessId: b.id, workerIds: (ws.data ?? []).filter((w) => w.business_id === b.id).map((w) => w.id),
    who: b.name?.trim() || "Electrician", line: approveElectricianLine(b.name ?? "", names.get(b.added_by_installer_business_id!) ?? ""), since: since.get(b.id) ?? null,
    href: `/admin/partners/business/${b.id}`, isTest: isTestPartner(b),
  }));
}
