// Decision 393 (Jo, owner, 25 Oct 2026: "Yes, send all 54"): a one-off, DB-triggered send of the missed FIRST email to a
// fixed list of website enquiries, through the existing guarded senders only. Pure: body validation, the per-job refusal
// decision and PII-free result details. Nothing here sends or reads the database.
import { z } from "zod";

export const BACKLOG_SEND_KINDS = ["save_spot_none", "save_spot_existing", "questions"] as const;
export type BacklogSendKind = (typeof BACKLOG_SEND_KINDS)[number];
/** Jo approved 54; a little headroom, never an open-ended batch. */
export const BACKLOG_SEND_MAX = 60;
export type BacklogSendItem = { jobId: string; kind: BacklogSendKind };

const ITEM = z.object({ jobId: z.string().uuid(), kind: z.enum(BACKLOG_SEND_KINDS) }).strict();
const BODY = z.object({ sends: z.array(ITEM).min(1).max(BACKLOG_SEND_MAX) }).strict();

/** Strict: UUID job ids, known kinds, 1..60 items, no duplicate job ids, no extra fields. Any problem = nothing sent. */
export function parseBacklogSendBody(body: unknown): { ok: true; sends: BacklogSendItem[] } | { ok: false; error: string } {
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((i) => i.code === "too_big" && i.path.length === 1 && i.path[0] === "sends");
    return { ok: false, error: tooMany ? `At most ${BACKLOG_SEND_MAX} sends per call.` : "Body must be { sends: [{ jobId: uuid, kind: save_spot_none | save_spot_existing | questions }] }." };
  }
  const seen = new Set<string>();
  for (const s of parsed.data.sends) {
    const id = s.jobId.toLowerCase();
    if (seen.has(id)) return { ok: false, error: "Duplicate jobId in sends." };
    seen.add(id);
  }
  return { ok: true, sends: parsed.data.sends.map((s) => ({ jobId: s.jobId.toLowerCase(), kind: s.kind })) };
}

/** Facts re-read for one job just before its send. Read failures are reported by the server, never treated as "none". */
export type BacklogJobFacts = {
  jobNumber: string | null;
  source: string | null;
  stage: string | null;
  deletedAt: string | null;
  qaArchivedAt: string | null;
  eligibilityOutcome: string | null;
  spotSavedAt: string | null;
  campaignOptedOutAt: string | null;
  emailOptedOutAt: string | null;
  /** documents.kind = 'intake_media' rows for the job. */
  intakeMediaCount: number;
  mediaReceivedAt: string | null;
  /** Sent or in-flight Save my spot offers (save_my_spot / existing_insulation_save_spot / likely_size / office_outlook_save_spot). */
  priorOfferCount: number;
  /** Sent or in-flight 3-questions invitations (insulation_details key). */
  priorQuestionsCount: number;
};

/** null = may go to the existing sender (which still runs every guard of its own). */
export function backlogRefusal(kind: BacklogSendKind, f: BacklogJobFacts, legacyExcluded: string | null = null): string | null {
  if (f.source === "qa_test") return "TEST job — not part of the backlog send.";
  if (f.source !== "base44") return "Not a website enquiry.";
  if (f.deletedAt) return "Job is deleted.";
  if (f.qaArchivedAt) return "Job is archived.";
  if (f.stage === "cancelled") return "Job is cancelled.";
  if (f.campaignOptedOutAt || f.emailOptedOutAt) return "Owner opted out.";
  if (f.spotSavedAt) return "Spot already saved.";
  if (f.eligibilityOutcome === "does_not_appear_eligible") return "Does not appear eligible.";
  if (legacyExcluded) return `Excluded by Jo (${legacyExcluded}).`;
  // Jo's "send all 54" covers owners who only got a photo request or (wrongly) the questions email, so an earlier email
  // alone never blocks; an earlier Save my spot offer always does, and nobody gets the same questions email twice.
  if (f.priorOfferCount > 0) return "Already offered a spot.";
  if (kind === "questions" && f.priorQuestionsCount > 0) return "Already got the 3-questions email.";
  if (kind === "questions" && (f.intakeMediaCount > 0 || f.mediaReceivedAt)) return "Owner already sent photos/video — no 3-questions email.";
  return null;
}

/** save_spot_existing: the qualification answer recorded for the router's existing-insulation offer (decision 392:
 *  "unknown" when the estimate's insulation is unknown). Anything else is not an existing-insulation estimate. */
export function existingInsulationAnswer(estimateInsulation: string | null | undefined): "present" | "unknown" | null {
  return estimateInsulation === "present" || estimateInsulation === "unknown" ? estimateInsulation : null;
}

export type BacklogOutcome = "sent" | "skipped" | "failed" | "uncertain";
/** Sender outcomes → response outcome. "uncertain" (may have been accepted) is reported, counted as failed, never retried. */
export function backlogOutcome(senderOutcome: string | null | undefined): BacklogOutcome {
  if (senderOutcome === "sent") return "sent";
  if (senderOutcome === "skipped" || senderOutcome === "blocked") return "skipped";
  if (senderOutcome === "uncertain") return "uncertain";
  return "failed";
}

/** Response details carry no addresses, emails or phone numbers: provider/system messages are scrubbed and capped. */
export function safeDetail(detail: string | null | undefined): string {
  return String(detail ?? "")
    .replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[number]" : m))
    .slice(0, 200);
}

export type BacklogResult = { jobNumber: string | null; kind: BacklogSendKind; outcome: BacklogOutcome; detail: string };
export function backlogSummary(results: BacklogResult[]) {
  const n = (o: BacklogOutcome) => results.filter((r) => r.outcome === o).length;
  return { ok: true as const, sent: n("sent"), skipped: n("skipped"), failed: n("failed") + n("uncertain"), results };
}
