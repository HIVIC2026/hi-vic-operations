// Decision 326: pure helpers for the trade messages wired in trade-messages.server.ts (I24 owner declined, I53 application
// received). No network, no database.
import { DECLINE_REASONS } from "./quote-decline.core";

/** Append-only admin_config_events row recorded once per application BEFORE the I53 email is sent. */
export const APPLICATION_RECEIVED_EVENT = "application_received_email" as const;

/** The stored decline reason is "<label>: <owner's words>" (quote-decline.core declineReasonText). Split it back for the
 *  I24 "Reason given" box; text that does not start with a known label is the owner's own words. */
export function splitDeclineReason(stored: string | null | undefined): { label: string | null; note: string | null } {
  const s = stored?.trim() || "";
  if (!s) return { label: null, note: null };
  for (const r of DECLINE_REASONS) {
    if (s === r.label) return { label: r.label, note: null };
    if (s.startsWith(`${r.label}: `)) return { label: r.label, note: s.slice(r.label.length + 2).trim() || null };
  }
  return { label: null, note: s };
}

/** I53 recipient + names from the signed application's answers (business email first, then the signer's email). */
export function applicationReceivedFacts(data: Record<string, unknown>, signerEmail: string | null | undefined, signerName: string | null | undefined): { to: string | null; contactName: string | null; businessName: string | null } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const to = str(data["business_email"]) ?? str(signerEmail);
  return {
    to: to && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ? to : null,
    contactName: str(data["primary_contact_name"]) ?? str(signerName),
    businessName: str(data["trading_name"]) ?? str(data["legal_entity_name"]),
  };
}
