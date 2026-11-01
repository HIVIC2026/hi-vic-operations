// In-house orchestration only; canonical writers retain template, booking and create-claim guards.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MittiCall } from "./mitti.core";
import { stableUuid, isUniqueViolation } from "./mitti-create-claim.core";

const db = supabaseAdmin as unknown as SupabaseClient;
type Kind = "ready_check" | "piesa" | "rectification" | "install";
type Form = { kind: Kind; auditId: string; done: boolean };
type Assignment = { user_id: string; business_id: string | null; profiles: { email: string | null; full_name?: string | null } | null };
async function read<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const r = await q; if (r.error) throw new Error(r.error.message); return r.data as T;
}
export async function isInHouseFormJob(jobId: string): Promise<boolean> {
  const state = await (await import("./in-house-suppression.server")).readInHouseDispatchState([jobId]);
  if (state.failed) throw new Error("Couldn't check the job's partner — please try again.");
  return state.held.has(jobId);
}
async function events(jobId: string) {
  const rows: { event_type: string; details: Record<string, unknown> | null; created_at: string }[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await read<typeof rows>(db.from("workflow_events").select("event_type,details,created_at").eq("job_id", jobId).in("event_type", ["mitti_piisa_audit_created", "mitti_piisa_completed", "fixes_form_created", "fixes_form_completed", "in_house_form_closed_unused", "rectification_form_closed_unused", "visit_allocated", "piisa_crew_selected"]).order("created_at", { ascending: false }).range(offset, offset + 199));
    rows.push(...page); if (page.length < 200) return rows;
  }
}
async function formFacts(jobId: string): Promise<Form[]> {
  const [m, a, history] = await Promise.all([
    read<{ external_source: string; external_id: string | null; status: string } | null>(db.from("ceiling_measurements").select("external_source,external_id,status").eq("job_id", jobId).eq("is_current", true).maybeSingle()),
    read<{ external_mitti_id: string | null; status: string; mitti_completed?: boolean } | null>(db.from("assessments").select("external_mitti_id,status,mitti_completed").eq("job_id", jobId).maybeSingle()), events(jobId),
  ]);
  const forms: Form[] = [];
  if (m?.external_source === "mitti" && m.external_id) forms.push({kind:"ready_check",auditId:m.external_id,done:m.status === "complete"});
  if (a?.external_mitti_id) forms.push({kind:"piesa",auditId:a.external_mitti_id,done:a.status === "complete" || a.mitti_completed === true});
  for (const [kind, created, completed] of [["install","mitti_piisa_audit_created","mitti_piisa_completed"],["rectification","fixes_form_created","fixes_form_completed"]] as const) {
    for (const e of history.filter(e => e.event_type === created)) {
      const id = e.details?.['audit_id'];
      if (typeof id === "string" && !forms.some(f=>f.auditId===id)) forms.push({kind,auditId:id,done:history.some(e=>e.event_type===completed && e.details?.['audit_id']===id)});
    }
  }
  return forms.filter(f=>!history.some(e=>["in_house_form_closed_unused","rectification_form_closed_unused"].includes(e.event_type) && e.details?.['audit_id']===f.auditId));
}
async function assignment(jobId: string, role: string) {
  return read<Assignment | null>(db.from("job_assignments").select("user_id,business_id,profiles:user_id(email,full_name)").eq("job_id",jobId).eq("role",role).eq("active",true).maybeSingle());
}
/** Selected Team electrician, otherwise the installer-office account holds preparation, never an electrician assignment. */
export async function inHousePreparationAssignee(jobId: string) {
  if (!await isInHouseFormJob(jobId)) throw new Error("Not an in-house job");
  const [installer,electrician] = await Promise.all([assignment(jobId,"installer"),assignment(jobId,"electrician")]);
  if (!installer) throw new Error("No installer assigned");
  if (electrician && electrician.business_id !== installer.business_id) throw new Error("Electrician is not on this installer's Team");
  const holder = electrician ?? installer;
  const job = await read<{source:string} | null>(db.from("jobs").select("source").eq("id",jobId).maybeSingle());
  const email = job?.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : holder.profiles?.email?.trim();
  if (!email) throw new Error("The form holder needs a Mitti email");
  return {userId:holder.user_id,fullName:holder.profiles?.full_name ?? null,email,selected:!!electrician};
}
async function leadAssignee(jobId: string) {
  const installer = await assignment(jobId,"installer");
  if (!installer?.business_id) throw new Error("No installer assigned");
  const history = await events(jobId);
  const { currentAllocation } = await import("./visit-allocation.core");
  const allocation = currentAllocation(history,"install");
  const selection = history.find(e=>e.event_type==="piisa_crew_selected")?.details?.['selection'];
  const { leadWorkerId } = await import("./piisa-a3.core");
  const workerId = selection ? leadWorkerId(selection as import("./piisa-a3.core").CrewSelection) : allocation?.worker_id;
  if (!workerId) throw new Error("Choose the install Lead before creating the install form.");
  const worker = await read<{email:string|null;full_legal_name?:string;worker_role:string|null;trade_role:string} | null>(db.from("partner_workers").select("email,full_legal_name,worker_role,trade_role").eq("id",workerId).eq("business_id",installer.business_id).is("removed_at",null).maybeSingle());
  if (!worker || worker.worker_role !== "lead" || worker.trade_role !== "installer") throw new Error("Choose a Lead from your Team.");
  const job = await read<{source:string} | null>(db.from("jobs").select("source").eq("id",jobId).maybeSingle());
  const email = job?.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : worker.email?.trim();
  if (!email) throw new Error("The Lead needs a Mitti email");
  return {userId:installer.user_id,fullName:worker.full_legal_name ?? null,email};
}
export async function ensureInHouseForms(jobId: string, actorId: string | null, call?: MittiCall): Promise<{readyCheck:string|null;piesa:string|null;fixes:string|null}> {
  if (!await isInHouseFormJob(jobId)) return {readyCheck:null,piesa:null,fixes:null};
  const f = await (await import("./mitti-create.server")).readyCheckFormFacts(jobId);
  if (!f?.booked) throw new Error("The Ready Check isn't booked yet");
  if (!f.mittiInvited || !f.autoSend || !f.templateSet) throw new Error("Ready Check form preparation is not enabled for this partner");
  const mitti = await import("./mitti.server");
  const forms = await formFacts(jobId);
  let readyCheck = forms.find(f=>f.kind==="ready_check")?.auditId ?? null;
  let piesa = forms.find(f=>f.kind==="piesa")?.auditId ?? null;
  let fixes = (await (await import("./fixes-day.server")).existingRectificationForm(jobId,true))?.auditId ?? null;
  if (!readyCheck) readyCheck = (await mitti.createAssignMittiAudit(jobId,actorId,call ?? mitti.realMittiCall,{readyCheck:true})).auditId;
  const holder = await inHousePreparationAssignee(jobId);
  if (!piesa) piesa = (await mitti.createAssignMittiAudit(jobId,actorId,call ?? mitti.realMittiCall,{inHousePreparation:true,assignee:holder})).auditId;
  if (!fixes) {
    const r = await (await import("./fixes-day.server")).createFixesForm(jobId,actorId,`ready-check:${jobId}`,call,{atReadyCheckBooking:true});
    if (!r.auditId) throw new Error(r.reason ?? "Rectification form could not be prepared");
    fixes = r.auditId;
  }
  if (holder.selected && forms.length === 0) {
    const mittiUserId = await mitti.findMittiUserByEmail(holder.email,call ?? mitti.realMittiCall);
    if (!mittiUserId) throw new Error("Add this electrician in Mitti first.");
    for (const [kind,auditId] of [["piesa",piesa],["rectification",fixes]] as const) if (auditId) await mitti.reassignMittiFormTo({jobId,auditId,kind,mittiUserId,email:holder.email,actorId},call ?? mitti.realMittiCall);
  }
  return {readyCheck,piesa,fixes};
}
export async function ensureInstallForm(jobId: string, actorId: string | null, call?: MittiCall): Promise<string|null> {
  if (!await isInHouseFormJob(jobId)) return null;
  const existing = (await formFacts(jobId)).find(f=>f.kind==="install");
  if (existing) return existing.auditId;
  const lead = await leadAssignee(jobId);
  const mitti = await import("./mitti.server");
  return (await mitti.createPiisaMittiAudit(jobId,actorId,call ?? mitti.realMittiCall,{assignee:lead})).auditId;
}
export async function syncInHouseForms(jobId: string, change: "date"|"person"|"crew", actorId: string | null = null, call?: MittiCall) {
  if (!await isInHouseFormJob(jobId)) return;
  const forms = (await formFacts(jobId)).filter(f=>!f.done);
  const bookings = await read<{kind:string;scheduled_start:string}[]>(db.from("bookings").select("kind,scheduled_start").eq("job_id",jobId).eq("status","confirmed").order("created_at",{ascending:false}));
  const mitti = await import("./mitti.server");
  for (const form of forms) {
    if (change === "date") {
      const bookingKind = {ready_check:"ready_check",piesa:"assessment",rectification:"rectification",install:"installation"}[form.kind];
      const start = bookings.find(b=>b.kind===bookingKind)?.scheduled_start;
      if (start) await (await import("./mitti-pickup.server")).updateMittiFormDate(jobId,start,actorId,call ?? mitti.realMittiCall,{auditId:form.auditId,kind:form.kind});
    } else {
      const holder = form.kind === "install" ? await leadAssignee(jobId) : form.kind === "piesa" || form.kind === "rectification" ? await inHousePreparationAssignee(jobId) : await assignment(jobId,"installer").then(a=>a?.profiles?.email ? {email:a.profiles.email} : null);
      if (!holder || ("selected" in holder && !holder.selected)) continue;
      const mittiUserId = await mitti.findMittiUserByEmail(holder.email,call ?? mitti.realMittiCall);
      if (!mittiUserId) throw new Error("Add this person in Mitti first.");
      await mitti.reassignMittiFormTo({jobId,auditId:form.auditId,kind:form.kind,mittiUserId,email:holder.email,actorId},call ?? mitti.realMittiCall);
      if (change === "crew" && form.kind === "install") await mitti.updateMittiInstallCrew(jobId,form.auditId,actorId,call ?? mitti.realMittiCall);
    }
  }
}
/** Portal-only closure: deterministic history IDs keep repeated calls and concurrent retries harmless. */
export async function closeUnneededForms(jobId: string, reason: string, actorId: string | null = null): Promise<number> {
  if (!await isInHouseFormJob(jobId)) return 0;
  const candidates = (await formFacts(jobId)).filter(f=>!f.done && (reason !== "no_upgrades" || f.kind === "rectification"));
  let count = 0;
  for (const form of candidates) {
    const event_type = form.kind === "rectification" ? "rectification_form_closed_unused" : "in_house_form_closed_unused";
    const {error} = await db.from("workflow_events").insert({id:await stableUuid(`in-house-unused:${jobId}:${form.auditId}`),job_id:jobId,actor_id:actorId,event_type,summary:`Unused ${form.kind === "rectification" ? "rectification" : form.kind === "install" ? "install" : form.kind === "piesa" ? "PIESA" : "Ready Check"} form closed in the portal`,details:{audit_id:form.auditId,kind:form.kind,reason,portal_only:true},internal:true});
    if (error && !isUniqueViolation(error)) throw new Error(error.message);
    if (!error) count++;
  }
  // Repair a missing note after an interrupted first attempt, without a second note on replay.
  if (candidates.length || (await events(jobId)).some(e=>e.details?.['reason']===reason && ["in_house_form_closed_unused","rectification_form_closed_unused"].includes(e.event_type))) {
    const note = reason === "no_upgrades" ? "Rectification form not needed — you can ignore it in Mitti." : "Unused forms closed in the portal — you can ignore them in Mitti.";
    const {error} = await db.from("workflow_events").insert({id:await stableUuid(`in-house-unused-note:${jobId}:${reason}`),job_id:jobId,actor_id:actorId,event_type:"installer_note",summary:note,details:{note,reason,portal_only:true},internal:false});
    if (error && !isUniqueViolation(error)) throw new Error(error.message);
  }
  return count;
}