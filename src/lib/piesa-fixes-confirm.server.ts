// Decision 330: the owner confirms the ELECTRICAL FIXES by secure link — READS + the one signing write. No senders here (the
// request/reminder sweep is piesa-fixes-confirm-send.server.ts). Never a booking gate. Rules: piesa-fixes-confirm.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { hashToken } from "./worker-links.core";
import {
  PIESA_FIXES_CONFIRMED_EVENT, buildPiesaFixesConfirmation, fixesConfirmationFromEvents, ownerFixesConfirmationForForm, piesaFixesConfirmedSummary,
  validateOwnerFixesConfirmation, type PiesaFixesConfirmFacts,
} from "./piesa-fixes-confirm.core";

/** The latest post_rectification PIESA record (the A4 fixes) with what the page needs. Null = no fixes recorded. */
export async function ownerFixesConfirmFacts(jobId: string): Promise<PiesaFixesConfirmFacts | null> {
  const { data: rec } = await admin.from("piesa_records").select("id, completed_date, created_at").eq("job_id", jobId).eq("kind", "post_rectification").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!rec || !rec.completed_date) return null;
  const [{ data: events }, { data: elecAsg }] = await Promise.all([
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PIESA_FIXES_CONFIRMED_EVENT),
    admin.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle(),
  ]);
  let electrician: PiesaFixesConfirmFacts["electrician"] = { name: null, recName: null };
  if (elecAsg?.user_id) {
    const { data: ep } = await admin.from("profiles").select("full_name, business_id").eq("id", elecAsg.user_id).maybeSingle();
    const { data: eb } = ep?.business_id ? await admin.from("businesses").select("name, legal_name").eq("id", ep.business_id).maybeSingle() : { data: null };
    electrician = { name: ep?.full_name ?? null, recName: (eb as { legal_name?: string | null; name?: string | null } | null)?.legal_name ?? (eb as { name?: string | null } | null)?.name ?? null };
  }
  return { recordId: rec.id, fixesDate: rec.completed_date, completedAt: rec.created_at, electrician, confirmation: fixesConfirmationFromEvents(events ?? [], rec.id) };
}

/** ExpandContext.ownerFixesConfirmation for the official PIESA. Null = not confirmed (flagged by the expansion, never filled). */
export async function ownerFixesConfirmationForExpand(jobId: string): Promise<{ name: string; date: string } | null> {
  return ownerFixesConfirmationForForm((await ownerFixesConfirmFacts(jobId))?.confirmation ?? null);
}

/** The owner confirms the fixes on the secure link (no code). Idempotent per post_rectification record. */
export async function signOwnerFixesConfirmation(p: { jobId: string; fullName: string; signatureName: string; authority: "owner" | "authorised_representative"; confirmed: boolean; ip: string | null; userAgent: string | null }): Promise<{ ok: true; already: boolean; signedAt: string }> {
  const facts = await ownerFixesConfirmFacts(p.jobId);
  if (!facts) throw new WorkflowError("There are no electrical fixes to confirm yet.");
  if (facts.confirmation) return { ok: true, already: true, signedAt: facts.confirmation.signedAt };
  const errs = validateOwnerFixesConfirmation({ fullName: p.fullName, confirmed: p.confirmed, signatureName: p.signatureName, authority: p.authority });
  if (errs.length) throw new WorkflowError(errs.join(" "));
  const signedAt = new Date().toISOString();
  const details = buildPiesaFixesConfirmation({
    facts, name: p.fullName, authority: p.authority, signedAt,
    ipHash: p.ip ? await hashToken(`piesa-fixes-confirm-ip:${p.ip}`) : null, uaHash: p.userAgent ? await hashToken(`piesa-fixes-confirm-ua:${p.userAgent}`) : null,
  });
  await logEvent(p.jobId, null, PIESA_FIXES_CONFIRMED_EVENT, piesaFixesConfirmedSummary(details), details as unknown as Record<string, unknown>);
  return { ok: true, already: false, signedAt };
}
