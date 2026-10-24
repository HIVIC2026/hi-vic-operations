// Jo 23 Oct 08:14 UTC / decision 180 (24 Oct 2026): after an owner answers the 3 questions or uploads photos/video,
// send Save my spot (thin/patchy wording for thin/loose fill, otherwise the standard existing-insulation wording)
// through the same guarded automatic route as every other first reply: activation + history blockers in
// lead-email-routing.server.ts, then sendSaveMySpot / sendExistingInsulationSaveSpot (renderJoOutcomeEmail O1/O2,
// customer_comms_enabled, consent, once-per-home idempotency key). Nothing here renders or sends on its own.
// The office batch campaign sender/page was removed (superseded by three-questions-reminder.*).
import { INSULATION_QUESTIONS_SEND_APPROVED } from "./insulation-questions-campaign.core";

export async function sendAnsweredOwnerSaveSpot(jobId: string) {
  if (!INSULATION_QUESTIONS_SEND_APPROVED) return { sent: false, reason: "Sending is off until Jo says go." };
  const { maybeAutoRouteLeadEmail } = await import("./lead-email-routing.server");
  return maybeAutoRouteLeadEmail(jobId);
}
