// Sending mail from the info@ Outlook mailbox through the connector gateway (Microsoft Graph). Only the guarded sender
// (owner-email-send.server) and the Emails tab's no-job reply call this; the guard owns opt-outs, QA routing and the
// once-only reservation. Never throws: every problem comes back as { outcome: "failed", detail }.
import { normaliseMailbox, outlookGatewayUrl, outlookMailboxPath, OUTLOOK_REQUEST_REDIRECT } from "./outlook-connection.core";
import { outlookConfigured, readOutlookSyncState } from "./outlook-sync.server";

export const OUTLOOK_READ_ONLY_DETAIL = "Outlook is connected for reading only. Reconnect it in Lovable to allow sending.";
export type OutlookSendResult = { outcome: "sent"; messageId: string; internetMessageId: string | null } | { outcome: "failed"; detail: string }
  /** The send call may or may not have gone out (timeout/abort/5xx). Never resend, never delete the draft. */
  | { outcome: "uncertain"; detail: string; messageId: string };

async function call(method: string, mailbox: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(outlookGatewayUrl(`${outlookMailboxPath(mailbox)}${path}`), {
    method, redirect: OUTLOOK_REQUEST_REDIRECT, signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": process.env["MICROSOFT_OUTLOOK_API_KEY"]!,
      Prefer: 'IdType="ImmutableId"',
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status >= 300 && res.status < 400) throw new Error("Outlook tried to redirect; the request was not followed.");
  return res;
}

async function mailboxOrNull(): Promise<string | null> {
  if (!outlookConfigured()) return null;
  return normaliseMailbox((await readOutlookSyncState()).expected_mailbox);
}

/** Proves the connection may send: creates a throwaway draft and deletes it. Nothing is sent. */
export async function outlookSendAllowed(): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const mailbox = await mailboxOrNull();
    if (!mailbox) return { ok: false, detail: "Outlook isn't connected." };
    const res = await call("POST", mailbox, "/messages", { subject: "Send check (not sent)", body: { contentType: "Text", content: "" } });
    if (res.status === 403) return { ok: false, detail: OUTLOOK_READ_ONLY_DETAIL };
    if (!res.ok) return { ok: false, detail: `Outlook check failed (HTTP ${res.status}).` };
    const draft = (await res.json().catch(() => null)) as { id?: string } | null;
    if (draft?.id) await call("DELETE", mailbox, `/messages/${encodeURIComponent(draft.id)}`).catch(() => null);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Outlook check failed." };
  }
}

export async function sendViaOutlook(p: { replyToMessageId: string | null; to: string; subject: string; html: string }): Promise<OutlookSendResult> {
  let mailbox: string | null = null;
  let draftId: string | null = null;
  try {
    mailbox = await mailboxOrNull();
    if (!mailbox) return { outcome: "failed", detail: "Outlook isn't connected." };
    let draft: { id?: string; internetMessageId?: string | null } | null = null;
    if (p.replyToMessageId) {
      const r = await call("POST", mailbox, `/messages/${encodeURIComponent(p.replyToMessageId)}/createReply`, {});
      if (r.status !== 404) {
        if (r.status === 403) return { outcome: "failed", detail: OUTLOOK_READ_ONLY_DETAIL };
        if (!r.ok) return { outcome: "failed", detail: `Outlook couldn't start the reply (HTTP ${r.status}).` };
        draft = await r.json().catch(() => null);
        draftId = draft?.id ?? null;
        if (!draftId) return { outcome: "failed", detail: "Outlook returned no draft." };
        // Final review 5: if the draft can't be prepared, delete it (best-effort) so Drafts doesn't fill with owner-addressed
        // copies on every Try again. Nothing was sent, so deleting is safe.
        const dropDraft = (id: string) => call("DELETE", mailbox!, `/messages/${encodeURIComponent(id)}`).catch(() => null);
        let patch: Response;
        try {
          patch = await call("PATCH", mailbox, `/messages/${encodeURIComponent(draftId)}`, {
            subject: p.subject, body: { contentType: "HTML", content: p.html }, toRecipients: [{ emailAddress: { address: p.to } }],
          });
        } catch (e) { await dropDraft(draftId); throw e; }
        if (!patch.ok) { await dropDraft(draftId); throw new Error(`Outlook couldn't prepare the reply (HTTP ${patch.status}).`); }
      }
    }
    if (!draftId) { // no original message to reply to (or it no longer exists): a new message
      const r = await call("POST", mailbox, "/messages", {
        subject: p.subject, body: { contentType: "HTML", content: p.html }, toRecipients: [{ emailAddress: { address: p.to } }],
      });
      if (r.status === 403) return { outcome: "failed", detail: OUTLOOK_READ_ONLY_DETAIL };
      if (!r.ok) return { outcome: "failed", detail: `Outlook couldn't create the message (HTTP ${r.status}).` };
      draft = await r.json().catch(() => null);
      draftId = draft?.id ?? null;
      if (!draftId) return { outcome: "failed", detail: "Outlook returned no draft." };
    }
    let sent: Response;
    try { sent = await call("POST", mailbox, `/messages/${encodeURIComponent(draftId)}/send`); }
    catch (e) { return { outcome: "uncertain", detail: e instanceof Error ? e.message : "Outlook send gave no answer.", messageId: draftId }; }
    if (!sent.ok) {
      if (sent.status >= 500) return { outcome: "uncertain", detail: `Outlook gave no clear answer to the send (HTTP ${sent.status}).`, messageId: draftId };
      // A definite 4xx refusal: nothing went out, so the draft can be cleaned up.
      await call("DELETE", mailbox, `/messages/${encodeURIComponent(draftId)}`).catch(() => null);
      return { outcome: "failed", detail: sent.status === 403 ? OUTLOOK_READ_ONLY_DETAIL : `Outlook couldn't send it (HTTP ${sent.status}).` };
    }
    return { outcome: "sent", messageId: draftId, internetMessageId: draft?.internetMessageId ?? null };
  } catch (e) {
    return { outcome: "failed", detail: e instanceof Error ? e.message : "Outlook send failed." };
  }
}
