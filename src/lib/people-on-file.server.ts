// New job flow Part 9 Task 9 (Jo 2 Nov 2026): "required on file before working" — the people on a booking must each have
// a date of birth and a mobile; the Lead Installer and crew a verified CII/EEC; the electrician a verified licence + REC.
// Rule: worker-compliance.core requiredOnFileBlockers (pure). This reader finds WHO is on the booking (the proposed or
// allocated worker, the install's current Lead + saved crew) and gathers their facts through the existing readers
// (partner_workers, privateBirthDates — presence only, the date never leaves this module — and the crew clearance facts).
// A read error throws (fail closed). Nobody allocated yet = nothing to check here (the allocation writers check them).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { requiredOnFileBlockers, type PersonOnFile } from "./worker-compliance.core";

type Kind = "assessment" | "ready_check" | "rectification" | "installation";

/** The worker ids on the booking: electrician (proposed, else allocated) for the safety check / upgrades; the allocated
 *  person for a Ready Check; the current Lead + saved crew for an install. */
export async function workerIdsOnBooking(jobId: string, kind: Kind, proposedWorkerId: string | null): Promise<string[]> {
  if (kind === "assessment" || kind === "rectification") {
    const id = proposedWorkerId ?? (await (await import("./in-house-electrician.server")).allocatedWorkerId(jobId));
    return id ? [id] : [];
  }
  const { data: allocEv, error } = await admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).eq("event_type", "visit_allocated").order("created_at", { ascending: false }).limit(20);
  if (error) throw new WorkflowError(`Couldn't read who is going: ${error.message}`);
  const { currentAllocation } = await import("./visit-allocation.core");
  const cur = currentAllocation((allocEv ?? []) as { event_type: string; details: unknown; created_at: string }[], kind === "installation" ? "install" : "ready_check");
  if (kind === "ready_check") return [proposedWorkerId ?? cur?.worker_id ?? null].filter((x): x is string => !!x);
  const { data: crewEv, error: ce } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_crew_selected").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (ce) throw new WorkflowError(`Couldn't read the crew: ${ce.message}`);
  const sel = (crewEv as { details?: { selection?: { lead?: unknown; additional?: unknown[] } } | null } | null)?.details?.selection ?? null;
  const { leadWorkerId } = await import("./piisa-crew.core");
  const lead = proposedWorkerId ?? cur?.worker_id ?? (sel ? leadWorkerId(sel as never) : null);
  const crew = (Array.isArray(sel?.additional) ? sel!.additional! : []).map((a) => (typeof a === "string" ? a : (a as { workerId?: string } | null)?.workerId ?? null)).filter((x): x is string => !!x);
  return [...new Set([lead, ...crew].filter((x): x is string => !!x))];
}

/** The facts requiredOnFileBlockers needs for these workers. A read error throws. */
export async function peopleOnFile(workerIds: string[], installLeadId: string | null = null): Promise<PersonOnFile[]> {
  if (!workerIds.length) return [];
  const { data: workers, error } = await admin.from("partner_workers").select("id, business_id, full_legal_name, trade_role, worker_role, mobile, licence_number, rec_number, licence_expires_on, licence_verified_at").in("id", workerIds);
  if (error) throw new WorkflowError(`Couldn't read the people on the booking: ${error.message}`);
  const rows = (workers ?? []) as { id: string; business_id: string; full_legal_name: string | null; trade_role: string; worker_role: string | null; mobile: string | null; licence_number: string | null; rec_number: string | null; licence_expires_on: string | null; licence_verified_at: string | null }[];
  const missing = workerIds.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new WorkflowError("Someone on this booking is no longer on file. Choose the people again.");
  const { privateBirthDates } = await import("./worker-identity.server");
  const leadIds=rows.filter(r=>r.trade_role === "installer" && (r.id===installLeadId || r.worker_role!=="crew")).map(r=>r.id);
  const dobs = leadIds.length ? await privateBirthDates(leadIds) : new Map<string,string>();
  const { crewClearance, electricianVerified, melbourneToday } = await import("./worker-compliance.core");
  const today = melbourneToday();
  const installers = rows.filter((r) => r.trade_role === "installer");
  const clearance = new Map<string, boolean>();
  for (const biz of new Set(installers.map((r) => r.business_id))) {
    const staff = await (await import("./piisa-a3.server")).crewStaff(biz);
    for (const s of staff) clearance.set(s.workerId, s.cleared ?? crewClearance({ certStatus: s.eecVerified ? "verified" : null, level: s.level ?? null, expiresOn: s.expiresOn ?? null }, today).cleared);
  }
  return rows.map((r) => ({
    name: r.full_legal_name?.trim() || "Unnamed person",
    role: r.trade_role === "electrician" ? "electrician" : r.id === installLeadId || r.worker_role !== "crew" ? "lead" : "crew",
    dateOfBirth: !!dobs.get(r.id),
    mobile: r.mobile,
    ciiVerified: clearance.get(r.id) ?? false,
    licenceRecVerified: r.trade_role === "electrician" && electricianVerified(r, today).ok,
  }));
}

/** Refuses (WorkflowError, one line per missing fact) a booking whose people aren't on file. */
export async function requirePeopleOnFileForBooking(jobId: string, kind: Kind, proposedWorkerId: string | null): Promise<void> {
  // Jo 5 Nov: Ready Check attendance is Team membership + Mitti/office access,
  // validated by the allocation writer, never install-day identity or credentials.
  if (kind === "ready_check") return;
  const ids = await workerIdsOnBooking(jobId, kind, proposedWorkerId);
  if (!ids.length) return;
  const problems = requiredOnFileBlockers(await peopleOnFile(ids, kind === "installation" ? ids[0]! : null));
  if (problems.length) throw new WorkflowError(`Not on file yet: ${problems.join("; ")}.`);
}
