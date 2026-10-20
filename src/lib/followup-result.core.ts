export type FollowupMessage = { text: string; tone: 'ok' | 'error' | 'info'; lock: boolean };
export function followupSendMessage(outcome: string, detail: string): FollowupMessage {
  if (outcome === 'sent') return { text: 'Sent — accepted by the email service.', tone: 'ok', lock: true };
  if (['blocked', 'skipped', 'failed'].includes(outcome)) return { text: `Not sent: ${detail}`, tone: 'error', lock: false };
  return { text: 'The email may have been accepted. Delivery is not confirmed. Check communication history before any further send; retry is blocked here.', tone: 'error', lock: true };
}
export function followupRequestError(mode: 'preview' | 'prepare' | 'send'): FollowupMessage {
  return mode === 'send'
    ? { text: 'The send request did not return a confirmed result. The email may have been accepted. Check communication history; retry is blocked here.', tone: 'error', lock: true }
    : { text: 'This action could not be confirmed. Refresh the enquiry and try the preview again.', tone: 'error', lock: false };
}
export function uncertainAttempt(status: string | null | undefined): boolean {
  return ['sending', 'queued', 'delivered_unrecorded', 'sending_unknown'].includes(status ?? '');
}
