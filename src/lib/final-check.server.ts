// Decision 372 (Jo, 25 Oct 2026): the one-screen Final check — gathers the stored facts for ONE job through the existing
// readers and hands them to the pure list (final-check.core.ts). Read-only: never moves the job, never signs or sends.
// `approveApJob` re-reads it and refuses unless every check passes; `transition` then re-runs every existing guard.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { finalCheckList, finalCheckReady, type FinalCheckFacts, type FinalCheckItem } from "./final-check.core";

export type FinalCheckScreen = { stage: string | null; items: FinalCheckItem[]; ready: boolean; reasons: string[]; flags: string[] };

const failed = (what: string) => (e: unknown) => { throw new Error(`Final check: ${what} could not be read (${(e as Error).message}).`); };

export async function finalCheckFacts(jobId: string, actorId: string | null): Promise<FinalCheckFacts> {
  const { getStage, stageEntryBlockers } = await import("./workflow.server");
  const [stage, piesaRows, rectOpen, booking, esc, warranty, invoice, evidence] = await Promise.all([
    getStage(jobId),
    admin.from("piesa_records").select("id, kind, outcome, completed_date, rectification_completed_at, created_at").eq("job_id", jobId).order("created_at", { ascending: false }),
    admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).neq("status", "removed"),
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("esc_notifications").select("sent_at, status").eq("job_id", jobId).in("status", ["sent", "accepted"]).not("sent_at", "is", null).order("sent_at").limit(1).maybeSingle(),
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "warranty_copy_provided").order("created_at").limit(1).maybeSingle(),
    admin.from("invoice_status").select("total_inc_gst, total_paid, kind").eq("job_id", jobId).eq("kind", "installation").limit(1).maybeSingle(),
    admin.from("evidence_requirements").select("label,status,required,gate,category").eq("job_id", jobId).eq("required", true),
  ]);
  for (const [what, r] of [["PIESA records", piesaRows], ["fixes items", rectOpen], ["installation booking", booking], ["ESC notice", esc], ["warranty record", warranty], ["invoice", invoice]] as const)
    if (r.error) throw new Error(`Final check: ${what} could not be read (${r.error.message}).`);
  const initial = (piesaRows.data ?? []).find((r) => r.kind === "initial") ?? null;
  const start = booking.data?.scheduled_start ?? null;

  const [ownerPiesa, fixesFacts, swms, decl, extras, consent, veec, gaps, guards] = await Promise.all([
    (await import("./piesa-owner-confirm.server")).ownerPiesaConfirmationBlockerFor(jobId),
    (await import("./piesa-fixes-confirm.server")).ownerFixesConfirmFacts(jobId).catch(failed("electrical fixes")),
    (await import("./swms.server")).swmsStatusFor(jobId),
    admin.from("installer_declarations").select("id, snapshot").eq("job_id", jobId).eq("status", "signed").maybeSingle(),
    (await import("./install-evidence.server")).installEvidenceStageExtras(jobId).catch(failed("install evidence")),
    (await import("./consent.server")).currentConsent(jobId),
    (await import("./assignment.server")).currentAssignment(jobId),
    warranty.data ? Promise.resolve([] as string[]) : (await import("./product-warranty.server")).warrantyGapsFor(jobId).catch(() => [] as string[]),
    stageEntryBlockers(jobId, "ready_for_veec", actorId).catch((e: Error) => [`The Ready for VEEC checks could not be read (${e.message}).`]),
  ]);
  const { a3EvidenceGate } = await import("./piisa-a3.core");
  const official = (decl.data?.snapshot as { official?: unknown } | null)?.official as Parameters<typeof a3EvidenceGate>[0];
  const { evidenceStageBlockers } = await import("./ap-review-evidence.core");
  const { consentValidityBlockers } = await import("./consent.core");
  const a = veec as { status?: string | null; installer_signed_at?: string | null; ap_signed_at?: string | null; consumer_signed_at?: string | null } | null;
  return {
    stage,
    piesa: initial ? { completedDate: initial.completed_date, outcome: initial.outcome, ownerConfirmationBlocker: ownerPiesa } : null,
    fixes: {
      needed: initial?.outcome === "fail" || (rectOpen.count ?? 0) > 0,
      sameVisit: !!initial?.rectification_completed_at,
      postFixes: fixesFacts ? { completedDate: fixesFacts.fixesDate, ownerConfirmed: !!fixesFacts.confirmation } : null,
    },
    swms: swms ? { complete: swms.complete, missing: swms.missing } : null,
    piisa: { declarationSigned: !!decl.data, blockers: decl.data ? a3EvidenceGate(official) : [] },
    installEvidence: [...extras.installEvidence, ...extras.productProblems],
    photos: evidenceStageBlockers("ready_for_veec", evidence.data ?? null, !!evidence.error),
    esc: { sentAt: esc.data?.sent_at ?? null, installStart: start },
    consentBlockers: consentValidityBlockers(consent as never, start),
    warranty: { providedAt: warranty.data?.created_at ?? null, productsNotOnFile: gaps },
    veec: { status: a?.status ?? null, installerSignedAt: a?.installer_signed_at ?? null, apSignedAt: a?.ap_signed_at ?? null, consumerSignedAt: a?.consumer_signed_at ?? null },
    payments: invoice.data ? { totalIncGst: Number(invoice.data.total_inc_gst ?? 0), totalPaid: Number(invoice.data.total_paid ?? 0) } : null,
    guards,
  };
}

/** The screen: every check, whether Approve is enabled, and the existing AP flags (a flagged job still needs a note). */
export async function finalCheckScreen(jobId: string, actorId: string | null): Promise<FinalCheckScreen> {
  const facts = await finalCheckFacts(jobId, actorId);
  const items = finalCheckList(facts);
  const { ready, reasons } = finalCheckReady(facts.stage, items);
  const flags = (await (await import("./ap-queue.server")).jobApFlags([jobId])).get(jobId) ?? [];
  return { stage: facts.stage, items, ready, reasons, flags };
}
