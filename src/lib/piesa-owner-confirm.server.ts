// Decision 296: owner confirms the PIESA by secure link — READS + the one signing write. No senders here (this module sits
// on the autoAdvance / stage-guard graph through workflow.server and booking.server); the request/reminder sweep lives in
// piesa-owner-confirm-send.server.ts. Rules: piesa-owner-confirm.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { hashToken } from "./worker-links.core";
import {
  PIESA_OWNER_CONFIRMED_EVENT, buildPiesaOwnerConfirmation, confirmationFromEvents, ownerConfirmationForForm, ownerPiesaConfirmationBlocker, piesaOwnerConfirmedSummary,
  validateOwnerPiesaConfirmation, type OwnerPiesaConfirmation, type PiesaOwnerConfirmFacts,
} from "./piesa-owner-confirm.core";
import { RECTIFICATION_OUTCOMES, shortAnswersFromEntries } from "./official-short.core";

const db = () => admin as unknown as { from: (t: string) => any };

/** PIESA record kinds the owner confirms: the electrician's assessment, first or re-done. Same set as the 30-day anchor
 *  (electrical-clearance.server), so the confirmation always belongs to the PIESA that starts the install window. */
export const OWNER_CONFIRMED_PIESA_KINDS = ["initial", "reassessment"] as const;

/** The electrician's PIESA (latest `initial` or `reassessment` piesa_records row — a re-done PIESA is a new row) with everything the page and the gate need. Null = no PIESA yet. */
export async function ownerPiesaConfirmFacts(jobId: string): Promise<PiesaOwnerConfirmFacts | null> {
  const { data: rec } = await admin.from("piesa_records").select("id, outcome, completed_date, created_at, signed_off_by").eq("job_id", jobId).in("kind", [...OWNER_CONFIRMED_PIESA_KINDS]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!rec || !rec.signed_off_by) return null;
  const [{ data: events }, { count: items }, { data: a }, { data: elecAsg }, copy] = await Promise.all([
    admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", PIESA_OWNER_CONFIRMED_EVENT),
    admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).not("status", "in", "(cancelled,removed)"),
    admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle(),
    admin.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle(),
    (await import("./official-forms.server")).currentCopy(jobId, "piesa").catch(() => ({ copy: null, unavailable: true })),
  ]);
  let electrician: PiesaOwnerConfirmFacts["electrician"] = { name: null, recName: null };
  if (elecAsg?.user_id) {
    const { data: ep } = await admin.from("profiles").select("full_name, business_id").eq("id", elecAsg.user_id).maybeSingle();
    const { data: eb } = ep?.business_id ? await admin.from("businesses").select("name, legal_name").eq("id", ep.business_id).maybeSingle() : { data: null };
    electrician = { name: ep?.full_name ?? null, recName: (eb as { legal_name?: string | null; name?: string | null } | null)?.legal_name ?? (eb as { name?: string | null } | null)?.name ?? null };
  }
  // "Electrician present on install day" = the PIESA's three-way outcome (short form) — never guessed from a blank.
  const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as { label: string; value: string | null }[]) : [];
  const short = entries.length ? shortAnswersFromEntries("piesa", entries) : {};
  const electricianOnInstallDay = short["rectificationOutcome"] === RECTIFICATION_OUTCOMES[2];
  let signedCopy: PiesaOwnerConfirmFacts["signedCopy"] = null;
  if (copy.copy) {
    const { data: row } = await db().from("official_form_signed_copies").select("snapshot_sha256").eq("id", copy.copy.id).maybeSingle();
    signedCopy = { id: copy.copy.id, sha: (row as { snapshot_sha256?: string | null } | null)?.snapshot_sha256 ?? null };
  }
  return {
    piesaRecordId: rec.id, completedDate: rec.completed_date, completedAt: rec.created_at,
    outcome: (rec.outcome as "pass" | "fail" | null) ?? null, rectificationRequired: (items ?? 0) > 0 || rec.outcome === "fail", electricianOnInstallDay,
    electrician, signedCopy, confirmation: confirmationFromEvents(events ?? [], rec.id),
  };
}

/** The confirmation for the job's current PIESA, or null. */
export async function ownerPiesaConfirmation(jobId: string): Promise<OwnerPiesaConfirmation | null> {
  return (await ownerPiesaConfirmFacts(jobId))?.confirmation ?? null;
}

/** ExpandContext.ownerConfirmation for the official PIESA (o.name / o.date / the four ticks). Null = flag, never fill. */
export async function ownerConfirmationForExpand(jobId: string): Promise<{ name: string; date: string } | null> {
  return ownerConfirmationForForm(await ownerPiesaConfirmation(jobId));
}

/** Gate: the reason the install cannot be booked yet (null = fine). Fails closed on a read error. */
export async function ownerPiesaConfirmationBlockerFor(jobId: string): Promise<string | null> {
  try {
    const f = await ownerPiesaConfirmFacts(jobId);
    return ownerPiesaConfirmationBlocker({ piesaRecordId: f?.piesaRecordId ?? null, confirmation: f?.confirmation ?? null });
  } catch (e) {
    return `The owner's safety-check confirmation could not be checked (${(e as Error).message}).`;
  }
}

/** The owner signs on the secure link (decision 306: link only, no 6-digit code). Idempotent per PIESA record. */
export async function signOwnerPiesaConfirmation(p: { jobId: string; userId: string | null; codeId: string | null; fullName: string; signatureName: string; authority: "owner" | "authorised_representative"; confirmed: boolean; ip: string | null; userAgent: string | null }): Promise<{ ok: true; already: boolean; signedAt: string }> {
  const facts = await ownerPiesaConfirmFacts(p.jobId);
  if (!facts) throw new WorkflowError("There's no electrical safety check to confirm yet.");
  if (facts.confirmation) return { ok: true, already: true, signedAt: facts.confirmation.signedAt };
  const errs = validateOwnerPiesaConfirmation({ fullName: p.fullName, confirmed: p.confirmed, signatureName: p.signatureName, authority: p.authority });
  if (errs.length) throw new WorkflowError(errs.join(" "));
  const signedAt = new Date().toISOString();
  const details = buildPiesaOwnerConfirmation({
    facts, name: p.fullName, authority: p.authority, signedAt, codeId: p.codeId,
    ipHash: p.ip ? await hashToken(`piesa-owner-confirm-ip:${p.ip}`) : null, uaHash: p.userAgent ? await hashToken(`piesa-owner-confirm-ua:${p.userAgent}`) : null,
  });
  await logEvent(p.jobId, p.userId, PIESA_OWNER_CONFIRMED_EVENT, piesaOwnerConfirmedSummary(details), details as unknown as Record<string, unknown>);
  return { ok: true, already: false, signedAt };
}
