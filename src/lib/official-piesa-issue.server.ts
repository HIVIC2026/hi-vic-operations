// Decision 350: the official PIESA mapping (piesa-map-2.0.0) is approved for live use, so when the electrician completes
// the PIESA from the live A3 Mitti form the portal files the official PIESA signed copy (and its Word form) through the
// SAME guarded path the A5 fixes regeneration uses (fixes-day.server regenerateOfficialPiesa): expandPiesa from the synced
// A3 answers, storeSignedCopy (blocked while the mapping is not approved for use), storeOfficialDocx.
// Night test run 25 Oct 2026: nothing filed that FIRST copy, so on every live job the A5 fixes regeneration ("no current
// signed PIESA copy"), the A5 install-day sign-off (Part 5 answers come from the signed PIESA), the owner/installer O28
// copies and the electrician's copy (decision 317) waited forever and the installation could never be recorded.
// Never invents an answer: it is held (one event per reason) when the mapping is blocked or the A3 is missing.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export const OFFICIAL_PIESA_ISSUED_EVENT = "official_piesa_issued";
export const OFFICIAL_PIESA_HELD_EVENT = "official_piesa_held";

type Entry = { label: string; value: string | null };
const entriesOf = (raw: unknown): Entry[] => (Array.isArray(raw) ? (raw as Entry[]).filter((e) => e && typeof e.label === "string") : []);

export type OfficialPiesaIssue = { status: "issued" | "already" | "held"; detail: string };

export async function issueOfficialPiesa(jobId: string, actorId: string | null): Promise<OfficialPiesaIssue> {
  const hold = async (detail: string): Promise<OfficialPiesaIssue> => {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", OFFICIAL_PIESA_HELD_EVENT).contains("details", { reason: detail });
    if (!count) await logEvent(jobId, actorId, OFFICIAL_PIESA_HELD_EVENT, `Official PIESA not filed yet: ${detail}`, { reason: detail }, { internal: true });
    return { status: "held", detail };
  };
  const { officialFormUseBlocker } = await import("./official-forms.core");
  const block = officialFormUseBlocker("piesa");
  if (block) return hold(block);
  const { currentCopy, storeSignedCopy, materialFacts, officialPrefillContext } = await import("./official-forms.server");
  const prev = await currentCopy(jobId, "piesa");
  if (prev.unavailable) return hold("signed-copy storage not set up");
  if (prev.copy) return { status: "already", detail: `signed copy ${prev.copy.id}` };
  const { data: a } = await admin.from("assessments").select("id, status, assessed_on, external_mitti_id, mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = entriesOf(a?.mitti_raw_snapshot);
  if (!a?.external_mitti_id || !entries.length) return hold("no synced Mitti PIESA form on this job");
  if (a.status !== "complete" || !a.assessed_on) return hold("the PIESA is not complete");
  // A48 batch 1: never file an official PIESA whose answers break the form's own rules.
  const rulesBlocker = await (await import("./piesa-rules-notice.server")).piesaRulesBlockerFor(jobId);
  if (rulesBlocker) return hold(rulesBlocker);
  const { data: asg } = await admin.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (!asg?.user_id) return hold("no assigned electrician to attribute the PIESA to");
  const { data: prof } = await admin.from("profiles").select("full_name").eq("id", asg.user_id).maybeSingle();
  const { shortAnswersFromEntries } = await import("./official-short.core");
  const { expandPiesa } = await import("./official-expand.core");
  const { todayMelbourne } = await import("./eligibility.server");
  const ctx = await officialPrefillContext(jobId, todayMelbourne(), null);
  // Decision 296: the owner block comes from the owner's secure-link confirmation (normally given after this copy).
  const ownerConfirmation = await (await import("./piesa-owner-confirm.server")).ownerConfirmationForExpand(jobId).catch(() => null);
  const expanded = expandPiesa(shortAnswersFromEntries("piesa", entries), { lifeSupportDeclared: ctx.lifeSupportDeclared, today: a.assessed_on, ownerConfirmation, ownerFixesConfirmation: null });
  const { facts } = await materialFacts(jobId, null);
  const id = await storeSignedCopy({ jobId, key: "piesa", answers: expanded.answers, signer: { userId: asg.user_id, name: prof?.full_name ?? "", role: "electrician" }, enteredDate: a.assessed_on, jobFacts: facts as unknown as Record<string, string>, acknowledgementIds: [], signature: `mitti:${a.external_mitti_id}` });
  let docx = "";
  try {
    const r = await (await import("./official-docx.server")).storeOfficialDocx(jobId, "piesa");
    docx = ` (${r.filled} items filled${r.missed.length ? `, ${r.missed.length} not placed` : ""})`;
  } catch (e) { docx = ` (Word form not stored yet: ${(e as Error).message})`; }
  await logEvent(jobId, actorId, OFFICIAL_PIESA_ISSUED_EVENT, `Official PIESA filed from the electrician's Mitti PIESA form${docx}`, { signed_copy_id: id, audit_id: a.external_mitti_id }, { internal: true });
  try {await (await import('./piesa-delivery.server')).deliverPiesaCopies(jobId);} catch(e){console.error('Combined PIESA owner email held',jobId,e instanceof Error?e.message:'Delivery unavailable');}
  return { status: "issued", detail: `signed copy ${id}` };
}
