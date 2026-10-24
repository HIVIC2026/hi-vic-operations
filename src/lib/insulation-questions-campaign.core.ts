// Jo 23 Oct 2026: after an owner answers the 3 insulation questions or uploads a photo/video, Save my spot goes out
// automatically through the guarded automatic route (insulation-questions-campaign.server.ts → lead-email-routing).
// Decision 180 (Jo, 24 Oct 2026): ON — delivery still sits behind `customer_comms_enabled` and every sender guard.
// The old office batch "Tell us about your insulation" campaign (audience rules, batches, office page) was superseded
// by the one-off 3-questions reminder (three-questions-reminder.*) and removed; its history stays in job records.
export const INSULATION_QUESTIONS_SEND_APPROVED = true;
