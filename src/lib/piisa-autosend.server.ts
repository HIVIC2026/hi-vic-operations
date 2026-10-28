// Jo 24 Oct 2026: automatic PIISA Mitti form the day(s) before the install, on the 15-minute tick, so the 6:30am
// daily text can link it. Rule: piisa-autosend.core.ts. Creation: createPiisaMittiAudit (same guards as the office
// button, one form per job). A failure is logged as a workflow event and retried about hourly until the install starts
// (F15); with the install today or tomorrow it also raises ONE office item (Needs me "piisa_form_failed").
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { PIISA_AUDIT_CREATED_EVENT, PIISA_AUTOSEND_FAILED_EVENT, PIISA_AUTOSEND_MAX_PER_TICK, PIISA_AUTOSEND_OFFICE_EVENT, piisaAutoSendDecision, piisaAutoSendOfficeAlertDue } from "./piisa-autosend.core";

export type PiisaAutoSendResult = { jobId: string; jobNumber: string; outcome: "created" | "skipped" | "failed"; message: string };

export async function sweepPiisaAutoSend(opts: { now?: Date; allowTest?: boolean; dryRun?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const { data: bks, error } = await admin.from("bookings").select("job_id, scheduled_start")
    .eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lt("scheduled_start", new Date(now.getTime() + 4 * 86_400_000).toISOString()).order("scheduled_start");
  if (error) throw new Error(`PIISA auto-send could not read bookings: ${error.message}`);
  const ids = [...new Set((bks ?? []).map((b) => b.job_id))];
  const results: PiisaAutoSendResult[] = [];
  if (!ids.length) return { checked: 0, results };
  const [{ data: jobs, error: je }, { data: events, error: ee }] = await Promise.all([
    admin.from("jobs").select("id, job_number, stage, source, deleted_at, qa_archived_at").in("id", ids),
    admin.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", ids).in("event_type", [PIISA_AUDIT_CREATED_EVENT, PIISA_AUTOSEND_FAILED_EVENT, PIISA_AUTOSEND_OFFICE_EVENT]).order("created_at", { ascending: false }),
  ]);
  if (je || ee) throw new Error("PIISA auto-send could not read job facts.");
  const { officialFormUseBlocker } = await import("./official-forms.core");
  const formBlocker = officialFormUseBlocker("piisa");
  const { prestartGate } = await import("./prestart.server");
  let created = 0;
  for (const j of jobs ?? []) {
    if (created >= PIISA_AUTOSEND_MAX_PER_TICK) break;
    const start = (bks ?? []).find((b) => b.job_id === j.id)?.scheduled_start ?? null;
    const mine = (events ?? []).filter((e) => e.job_id === j.id);
    const base = { stage: j.stage, source: j.source, deleted: !!j.deleted_at, archived: !!j.qa_archived_at, installStart: start, hasPiisaAudit: mine.some((e) => e.event_type === PIISA_AUDIT_CREATED_EVENT), formBlocker, lastFailureAt: mine.find((e) => e.event_type === PIISA_AUTOSEND_FAILED_EVENT)?.created_at ?? null };
    // Cheap facts first; the pre-start gate (several reads) only for jobs that would otherwise be created.
    const pre = piisaAutoSendDecision({ ...base, prestartLocked: false }, now, { allowTest: opts.allowTest ?? false });
    if (pre.action === "skip") { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "skipped", message: pre.reason }); continue; }
    const gate = await prestartGate(j.id, now).catch(() => ({ locked: true, reasons: ["pre-start check could not be read"] }));
    const d = piisaAutoSendDecision({ ...base, prestartLocked: gate.locked }, now, { allowTest: opts.allowTest ?? false });
    if (d.action === "skip") { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "skipped", message: d.reason }); continue; }
    if (opts.dryRun) { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "skipped", message: "dry run – would create" }); continue; }
    try {
      const { createPiisaMittiAudit } = await import("./mitti.server");
      const r = await createPiisaMittiAudit(j.id, null);
      created++;
      results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "created", message: r.reused ? `re-shared ${r.auditId}` : `created ${r.auditId}` });
    } catch (e) {
      // A held claim / uncertain outcome is owned by the retry sweep and the office item: skip, never log a new failure each hour.
      const { MittiClaimHeld, MittiOutcomeUncertain } = await import("./mitti-create.server");
      if (e instanceof MittiClaimHeld || e instanceof MittiOutcomeUncertain) { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "skipped", message: (e as Error).message }); continue; }
      const message = (e as Error).message;
      await logEvent(j.id, null, PIISA_AUTOSEND_FAILED_EVENT, `Automatic PIISA form not created: ${message}`, { install_start: start, message }, { internal: true }).catch(() => undefined);
      // F15: install today or tomorrow → one office item per install start (cleared by the form being created).
      const alerted = mine.some((e) => e.event_type === PIISA_AUTOSEND_OFFICE_EVENT && (e.details as { install_start?: string } | null)?.install_start === start);
      if (start && !alerted && piisaAutoSendOfficeAlertDue(start, now))
        await logEvent(j.id, null, PIISA_AUTOSEND_OFFICE_EVENT, `Install day form could not be created in Mitti: ${message}`.slice(0, 500), { install_start: start, message: message.slice(0, 300), needs_office: true }, { internal: true }).catch(() => undefined);
      results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "failed", message });
    }
  }
  return { checked: (jobs ?? []).length, results };
}
