// Jo's own one-off office emails to partner applicants and approved partners (7 Oct).
// Pure rules. Automated messages and anything to homeowners stay behind the TEST switches/allowlist.
import { TEST_ALLOWLIST, normaliseEmail } from "./test-send.core";

export const OFFICE_REPLY_TO = "info@homeinsulationvictoria.com.au";
export type OfficeEmailOrigin = "office_manual" | "automated";
export type OfficeRecipient = "applicant" | "partner" | "homeowner";

/** null = this email may go to the real address. Fails closed. */
export function officeEmailBlocker(x: { origin: OfficeEmailOrigin; recipient: OfficeRecipient; to: string | null | undefined; message: string | null | undefined }): string | null {
  if (x.origin !== "office_manual") return "Automated emails stay behind the sending switches.";
  if (x.recipient === "homeowner") return "Owner emails stay behind the sending switches.";
  const to = normaliseEmail(x.to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return "There's no valid email address on this record.";
  if (!(x.message ?? "").trim()) return "Type a message first.";
  return null;
}

/** Automated test-run applications never reach a typed address: they go to Jo's test inbox. */
export const officeEmailTo = (to: string, testMode: boolean) => (testMode ? TEST_ALLOWLIST.email[0] : normaliseEmail(to));

export function officeEmailCopy(x: { contactName: string | null; subject: string; message: string }) {
  const first = x.contactName?.trim().split(/\s+/)[0];
  const lines = x.message.trim().split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  return { subject: x.subject.trim() || "A message from Home Insulation Victoria", heading: first ? `Hi ${first},` : "Hello,", lines: [...lines, "Just reply to this email if you have any questions."] };
}
