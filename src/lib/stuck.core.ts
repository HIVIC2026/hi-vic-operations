// Pure "stuck job" detector for the admin pipeline. Read-only signals; never changes a job.
export interface StuckSignals {
  stage: string | null;
  lastActivityAt: string | null;
  invoiceSyncErrors: string[]; // invoices.last_sync_error non-null
  readyCheckFailed: boolean; // a ready_check_payments row failed and none paid
  readyCheckPaidAt: string | null; // paid, but job hasn't moved
  confirmedBookings: { kind: string; scheduled_start: string }[];
}

const HOUR = 3_600_000;
const BOOKED_STAGE: Record<string, string> = { assessment: "assessment_booked", rectification: "rectification_booked", installation: "installation_booked" };
const PRE_BOOKED: Record<string, string[]> = {
  assessment: ["awaiting_electrician", "assessment_booking"],
  rectification: ["rectification_scheduling"],
  installation: ["installation_scheduling"],
};
const CLOSED = ["complete", "cancelled", "on_hold"];
const EARLY = ["new_enquiry", "eligibility_review", "awaiting_electrician", "assessment_booking"];

export function stuckReasons(s: StuckSignals, now: Date, idleDays = 7): string[] {
  if (!s.stage || CLOSED.includes(s.stage)) return [];
  const out: string[] = [];
  for (const e of s.invoiceSyncErrors) out.push(`Xero sync failed: ${e.slice(0, 120)}`);
  if (s.readyCheckFailed) out.push("Ready Check payment failed – owner may need help");
  if (s.readyCheckPaidAt && EARLY.includes(s.stage) && now.getTime() - Date.parse(s.readyCheckPaidAt) > 24 * HOUR)
    out.push("Ready Check paid over 24h ago but job hasn't moved");
  for (const b of s.confirmedBookings) {
    if ((PRE_BOOKED[b.kind] ?? []).includes(s.stage)) out.push(`${b.kind[0]!.toUpperCase()}${b.kind.slice(1)} booking confirmed but stage not updated to ${BOOKED_STAGE[b.kind]!.replace(/_/g, " ")}`);
  }
  if (s.lastActivityAt && now.getTime() - Date.parse(s.lastActivityAt) > idleDays * 24 * HOUR)
    out.push(`No activity for over ${idleDays} days`);
  return out;
}
