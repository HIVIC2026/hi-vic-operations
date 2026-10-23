// Jo 23 Oct 2026: installer approves the drafted owner quote before the office may send it. Pure rules only.
// Approval is an append-only `installer_quote_approved` workflow event carrying the quote and form fingerprints;
// it counts only while both still match (office Adjust or a changed Mitti form cancel it automatically).

export const INSTALLER_QUOTE_APPROVAL_CODE = "INSTALLER_A1";
/** Reminder email to the installer (never SMS). OFF until Jo says go. */
export const INSTALLER_QUOTE_REMINDER_ENABLED = false;
export const INSTALLER_QUOTE_REMINDER_HOURS = 48;
export const WAITING_ON_INSTALLER = "Waiting on installer to approve the quote";

export type QuoteLine = { code?: string | null; description?: string | null; quantity?: number | string | null; unit_price_inc_gst?: number | string | null; line_total_inc_gst?: number | string | null };
export type ApprovalEvent = { at: string; quoteId: string; quoteFp: string; formFp: string; by: string | null };
export type ApprovalState = "approved" | "needs_check" | "form_changed" | "office_changed";

function hash(s: string): string {
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const n = (v: unknown) => (v == null || v === "" ? "" : Number(v).toFixed(2));

/** What the owner will see: every line, its price and the totals. Any change = a different fingerprint. */
export function quoteFingerprint(q: { subtotal_inc_gst?: unknown; veec_discount_inc_gst?: unknown; customer_total_inc_gst?: unknown }, lines: QuoteLine[]): string {
  const body = lines.map((l) => [l.code ?? "", l.description ?? "", n(l.quantity), n(l.unit_price_inc_gst), n(l.line_total_inc_gst)].join("~")).sort().join("|");
  return hash(`${n(q.subtotal_inc_gst)}/${n(q.veec_discount_inc_gst)}/${n(q.customer_total_inc_gst)}/${body}`);
}

/** The Mitti form answers stored on the current measurement; an unchanged re-sync keeps the same fingerprint. */
export function formFingerprint(snapshot: unknown): string {
  return hash(JSON.stringify(snapshot ?? null));
}

export function approvalState(x: { quoteId: string; quoteFp: string; formFp: string; approvals: ApprovalEvent[]; adjustedAfterApproval?: boolean }): ApprovalState {
  const latest = x.approvals.filter((a) => a.quoteId === x.quoteId).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!latest) return "needs_check";
  if (latest.quoteFp !== x.quoteFp) return x.adjustedAfterApproval ? "office_changed" : "form_changed";
  if (latest.formFp !== x.formFp) return "form_changed";
  return "approved";
}

/** A1 = installer's own leads; A2 = our leads priced from the rate card. */
export function approveButtonLabel(channel: string | null | undefined): string {
  return channel === "installer_sourced" ? "Quote is ready to send" : "Measurements are final";
}

/** Button enabled only when nothing is missing or held. */
export function canApprove(blockers: string[]): boolean {
  return blockers.filter((b) => b !== WAITING_ON_INSTALLER).length === 0;
}

/** One line for the installer's job card. */
export function approvalCardLine(state: ApprovalState, sent: boolean): string {
  if (sent) return "Waiting on owner: to accept the quote";
  if (state === "office_changed") return "You: office changed the quote — please check";
  if (state === "approved") return "Waiting on office: checking your quote";
  return "You: check the quote";
}

/** One reminder per quote version, 48 h after the quote was ready, only while still unapproved and unsent. */
export function reminderDue(x: { readyAt: string; now: number; state: ApprovalState; sent: boolean; remindedFps: string[]; quoteFp: string; enabled?: boolean }): boolean {
  if (!(x.enabled ?? INSTALLER_QUOTE_REMINDER_ENABLED)) return false;
  if (x.sent || x.state === "approved") return false;
  if (x.remindedFps.includes(x.quoteFp)) return false;
  return x.now - Date.parse(x.readyAt) >= INSTALLER_QUOTE_REMINDER_HOURS * 3_600_000;
}

export function readApprovalEvents(rows: { created_at: string; actor_id?: string | null; details: unknown }[]): ApprovalEvent[] {
  return rows.map((r) => { const d = (r.details ?? {}) as Record<string, unknown>; return { at: r.created_at, quoteId: String(d.quote_id ?? ""), quoteFp: String(d.quote_fp ?? ""), formFp: String(d.form_fp ?? ""), by: r.actor_id ?? null }; });
}

/** Office list: drafts the installer hasn't approved go to a separate "Waiting on installer" section. */
export function splitQuotesToCheck<T extends { quoteId: string | null; waitingOnInstaller?: boolean }>(rows: T[]): { ready: T[]; waiting: T[] } {
  return { ready: rows.filter((r) => !(r.quoteId && r.waitingOnInstaller)), waiting: rows.filter((r) => !!(r.quoteId && r.waitingOnInstaller)) };
}
