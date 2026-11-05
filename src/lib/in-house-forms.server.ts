// In-house orchestration only; canonical writers retain template, booking and create-claim guards.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MittiCall } from "./mitti.core";
import { stableUuid, isUniqueViolation } from "./mitti-create-claim.core";

const db = supabaseAdmin as unknown as SupabaseClient;
type Kind = "ready_check" | "piesa" | "rectification" | "install";
type Form = { kind: Kind; auditId: string; done: boolean; closed?: boolean };
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
    const page = await read<typeof rows>(db.from("workflow_events").select("event_type,details,created_at").eq("job_id", jobId).in("event_type", ["mitti_piisa_audit_created", "INSTALLER_DECLARATION_SIGNED", "fixes_form_created", "fixes_form_completed", "in_house_form_closed_unused", "rectification_form_closed_unused", "visit_allocated", "piisa_crew_selected"]).order("created_at", { ascending: false }).range(offset, offset + 199));
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
  for (const [kind, created, completed] of [["install","mitti_piisa_audit_created","INSTALLER_DECLARATION_SIGNED"],["rectification","fixes_form_created","fixes_form_completed"]] as const) {
    for (const e of history.filter(e => e.event_type === created)) {
      const id = e.details?.['audit_id'];
      if (typeof id === "string" && !forms.some(f=>f.auditId===id)) forms.push({kind,auditId:id,done:history.some(e=>e.event_type===completed && e.details?.['audit_id']===id)});
    }
  }
  return forms.map(f=>({...f,closed:history.some(e=>["in_house_form_closed_unused","rectification_form_closed_unused"].includes(e.event_type) && e.details?.['audit_id']===f.auditId)}));
}
export async function handbackFormIds(jobId:string){return (await formFacts(jobId)).map(f=>f.auditId);}
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
  if (!workerId) throw new Error("Choose the Lead Installer before creating the install form.");
  const worker = await read<{email:string|null;full_legal_name?:string;worker_role:string|null;trade_role:string} | null>(db.from("partner_workers").select("email,full_legal_name,worker_role,trade_role").eq("id",workerId).eq("business_id",installer.business_id).is("removed_at",null).maybeSingle());
  const {effectiveWorkerRole,mittiEmailFor} = await import("./worker-role.core");
  if (!worker || effectiveWorkerRole({tradeRole:worker.trade_role,stored:worker.worker_role}) !== "lead") throw new Error("Choose a Lead Installer from your Team.");
  const job = await read<{source:string} | null>(db.from("jobs").select("source").eq("id",jobId).maybeSingle());
  const business = await read<{email:string|null}|null>(db.from("businesses").select("email").eq("id",installer.business_id).maybeSingle());
  const email = job?.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : mittiEmailFor({role:"lead",ownEmail:worker.email,businessEmail:business?.email}).email;
  if (!email) throw new Error("The Lead Installer needs a Mitti email");
  return {userId:installer.user_id,fullName:worker.full_legal_name ?? null,email};
}
export async function ensureInHouseForms(jobId: string, actorId: string | null, call?: MittiCall): Promise<{readyCheck:string|null;piesa:string|null;fixes:string|null}> {
  if (!await isInHouseFormJob(jobId)) return {readyCheck:null,piesa:null,fixes:null};
  // Photo-quote installers (Jo 5 Nov 2026): a From photos give has no Ready Check form and no Ready Check booking.
  if (await (await import("./photo-quote.server")).photoGiveFor(jobId)) return {readyCheck:null,...await ensurePhotoJobForms(jobId,actorId,call)};
  const f = await (await import("./mitti-create.server")).readyCheckFormFacts(jobId);
  if (!f?.booked) throw new Error("The Ready Check isn't booked yet");
  if (!f.mittiInvited || !f.autoSend || !f.templateSet) throw new Error("Ready Check form preparation is not enabled for this partner");
  const mitti = await import("./mitti.server");
  const forms = await formFacts(jobId);
  let readyCheck = forms.find(f=>f.kind==="ready_check")?.auditId ?? null;
  if (!readyCheck) {
    const job = await read<{source:string}|null>(db.from("jobs").select("source").eq("id",jobId).maybeSingle());
    const installer = await assignment(jobId,"installer");
    const testEmail = job?.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : null;
    readyCheck = (await mitti.createAssignMittiAudit(jobId,actorId,call ?? mitti.realMittiCall,{readyCheck:true,...(testEmail && installer ? {assignee:{userId:installer.user_id,fullName:installer.profiles?.full_name ?? null,email:testEmail}} : {})})).auditId;
  }
  // The allocation can precede form creation. Hand the newly created/current form to that recorded attendee's
  // Mitti account, or the same partner-office fallback used by Ready Check allocation, without changing the attendee.
  if (readyCheck) {
    const {currentAllocation}=await import('./visit-allocation.core');
    const allocated=currentAllocation(await events(jobId),'ready_check');
    if (allocated?.worker_id && actorId) await (await import('./visit-allocation.server')).allocateVisit(jobId,actorId,'ready_check',allocated.worker_id,call);
  }
  return {readyCheck,...await preparePiesaAndFixes(jobId,actorId,forms,call)};
}
/** Photo-quote installers: the PIESA and upgrades (fixes) forms only — never a Ready Check form. Needs a From photos give
 *  and an enabled partner (invited to Mitti, auto-send on); same creators, claims and handover as the Ready Check path. */
export async function ensurePhotoJobForms(jobId: string, actorId: string | null, call?: MittiCall): Promise<{piesa:string|null;fixes:string|null}> {
  if (!await isInHouseFormJob(jobId)) return {piesa:null,fixes:null};
  if (!await (await import("./photo-quote.server")).photoGiveFor(jobId)) throw new Error("Not a photo quote job");
  const f = await (await import("./mitti-create.server")).readyCheckFormFacts(jobId);
  if (!f?.mittiInvited || !f.autoSend) throw new Error("Form preparation is not enabled for this partner");
  return preparePiesaAndFixes(jobId,actorId,await formFacts(jobId),call);
}
async function preparePiesaAndFixes(jobId: string, actorId: string | null, forms: Form[], call?: MittiCall): Promise<{piesa:string|null;fixes:string|null}> {
  const mitti = await import("./mitti.server");
  let piesa = forms.find(f=>f.kind==="piesa")?.auditId ?? null;
  let fixes = (await (await import("./fixes-day.server")).existingRectificationForm(jobId,true))?.auditId ?? null;
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
  return {piesa,fixes};
}
export async function ensureInstallForm(jobId: string, actorId: string | null, call?: MittiCall): Promise<string|null> {
  if (!await isInHouseFormJob(jobId)) return null;
  const existing = (await formFacts(jobId)).find(f=>f.kind==="install");
  if (existing) return existing.auditId;
  // Part 3 Task 4 fix 1 (4 Nov 2026): held while the Certificate of Electrical Safety is outstanding (missing, not ticked, or
  // unreadable — fail closed); created when it is ticked (coes-check / the pre-start sweep call releaseHeldInstallForm).
  const cert = await (await import("./certificate-later.server")).liveCertificateFact(jobId)
    .catch((e: unknown) => ({ certificate: "unchecked" as const, certificateWhy: e instanceof Error ? e.message : "certificate not read" }));
  if (cert.certificate === "missing" || cert.certificate === "unchecked") {
    const {error} = await db.from("workflow_events").insert({id:await stableUuid(`in-house-install-form-held:${jobId}`),job_id:jobId,actor_id:actorId,event_type:"in_house_install_form_held",summary:"Install form held until the Certificate of Electrical Safety is ticked",details:{certificate:cert.certificate,why:cert.certificateWhy},internal:true});
    if (error && !isUniqueViolation(error)) throw new Error(error.message);
    return null;
  }
  const lead = await leadAssignee(jobId);
  const mitti = await import("./mitti.server");
  return (await mitti.createPiisaMittiAudit(jobId,actorId,call ?? mitti.realMittiCall,{assignee:lead})).auditId;
}
/** Fix 1: create an in-house install form that was held for the certificate, once it is clear. Only for an in-house form
 *  job at installation_booked with no install form yet. `skipWhenLocked`: leave it while the pre-start gate is locked (a
 *  failed day-before check) — the sweep's next pass creates it. Throws on a real failure (callers log it for the office). */
export async function releaseHeldInstallForm(jobId: string, actorId: string | null, opts: { skipWhenLocked?: boolean } = {}, call?: MittiCall): Promise<string> {
  if (!await isInHouseFormJob(jobId)) return "not an in-house form job";
  const job = await read<{stage:string}|null>(db.from("jobs").select("stage").eq("id",jobId).maybeSingle());
  if (job?.stage !== "installation_booked") return "not at installation_booked";
  if ((await formFacts(jobId)).some(f=>f.kind==="install")) return "already has an install form";
  if (opts.skipWhenLocked && (await (await import("./prestart.server")).prestartGate(jobId)).locked) return "held: pre-start check locked";
  const auditId = await ensureInstallForm(jobId, actorId, call);
  if (!auditId) return "held: certificate outstanding";
  await syncInHouseForms(jobId, "date", actorId, call);
  return "created";
}
export async function syncInHouseForms(jobId: string, change: "date"|"person"|"crew", actorId: string | null = null, call?: MittiCall, previousWorkerId?:string|null) {
  if (!await isInHouseFormJob(jobId)) return;
  const forms = (await formFacts(jobId)).filter(f=>!f.done && !f.closed);
  const bookings = await read<{kind:string;scheduled_start:string}[]>(db.from("bookings").select("kind,scheduled_start").eq("job_id",jobId).eq("status","confirmed").order("created_at",{ascending:false}));
  const mitti = await import("./mitti.server");
  for (const form of forms) {
    if (change === "date") {
      const bookingKind = {ready_check:"ready_check",piesa:"assessment",rectification:"rectification",install:"installation"}[form.kind];
      const start = bookings.find(b=>b.kind===bookingKind)?.scheduled_start;
      if (start) await (await import("./mitti-pickup.server")).updateMittiFormDate(jobId,start,actorId,call ?? mitti.realMittiCall,{auditId:form.auditId,kind:form.kind});
    } else {
      if (change === "crew" && form.kind !== "install") continue;
      const holder = form.kind === "install" ? await leadAssignee(jobId) : form.kind === "piesa" || form.kind === "rectification" ? await inHousePreparationAssignee(jobId) : await assignment(jobId,"installer").then(a=>a?.profiles?.email ? {email:a.profiles.email} : null);
      if (!holder || ("selected" in holder && !holder.selected)) continue;
      const mittiUserId = await mitti.findMittiUserByEmail(holder.email,call ?? mitti.realMittiCall);
      if (!mittiUserId) throw new Error("Add this person in Mitti first.");
      if(change==='crew'&&form.kind==='install'){
        const installer=await assignment(jobId,'installer');
        const changes=await read<{details:{old_worker_id?:string}}[]>(db.from('workflow_events').select('details').eq('job_id',jobId).eq('event_type','in_house_lead_changed').order('created_at',{ascending:false}));
        const previousIds=new Set([previousWorkerId,...changes.map(e=>e.details.old_worker_id)].filter((id):id is string=>!!id));
        for(const previousId of previousIds){
        const old=await read<{email:string|null}|null>(db.from('partner_workers').select('email').eq('id',previousId).eq('business_id',installer?.business_id??'').maybeSingle());
        // A shared office/TEST identity is not a different person: never revoke the new holder's access.
        if(old?.email&&old.email.trim().toLowerCase()!==holder.email.trim().toLowerCase()){
          const routed=await mitti.mittiCallFor(call??mitti.realMittiCall,holder.email);
          const oldUserId=await mitti.findMittiUserByEmail(old.email,routed);
          if(!oldUserId)throw Error('Could not identify the previous Lead Installer in Mitti; office handover required.');
          if(oldUserId!==mittiUserId)await (await import('./mitti.core')).mittiApi(routed).removeInspectionUserAccess(form.auditId,oldUserId);
        }
        }
      }
      // Revoke the previous person's direct access BEFORE sharing. If revocation
      // fails, no new access is granted; a saved-work retry resumes the handover.
      await mitti.reassignMittiFormTo({jobId,auditId:form.auditId,kind:form.kind,mittiUserId,email:holder.email,actorId},call ?? mitti.realMittiCall);
      if (change === "crew" && form.kind === "install") await mitti.updateMittiInstallCrew(jobId,form.auditId,actorId,call ?? mitti.realMittiCall);
    }
  }
}
/** Portal-only closure: deterministic history IDs keep repeated calls and concurrent retries harmless. */
export async function closeUnneededForms(jobId: string, reason: string, actorId: string | null = null): Promise<number> {
  if (!await isInHouseFormJob(jobId)) {
    const back=await db.from('workflow_events').select('id').eq('job_id',jobId).eq('event_type','in_house_pulled_back').limit(1).maybeSingle();
    if(back.error)throw Error(back.error.message);if(reason!=='handed_back'||!back.data)return 0;
  }
  const candidates = (await formFacts(jobId)).filter(f=>!f.done && !f.closed && (reason !== "no_upgrades" || f.kind === "rectification"));
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