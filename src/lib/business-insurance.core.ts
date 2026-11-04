// My business › Insurance and licences — the APPROVED redraft (Jo 4 Nov 2026 19:50, pack 2 batch 3, picture 11). PURE
// wording: the top line, each row's status line and the button. The rules (what blocks, the 30/7-day reminders) live in
// trade-expiry.core / insurance-reminder.core; this only says them plainly on the page.

/** Jo's words (4 Nov 2026). */
export const INSURANCE_PAGE_WORDS = {
  intro: "Keep these current. If one runs out, you can't take new jobs, bookings or installs until the new certificate is uploaded and we've checked it. We'll remind you 30 days and 7 days before anything expires.",
  upload: "Upload a new certificate",
  waiting: "Waiting for us to check",
  checkedUntil: (date: string) => `Checked · current until ${date}`,
  expired: (date: string) => `Expired ${date} — upload the new one`,
  /** Checked but no expiry date recorded (rare: old rows) — DRAFT, not Jo's words. */
  checkedNoDate: "Checked · no expiry date recorded",
} as const;

/** "Fri 19 Nov 2026" from YYYY-MM-DD (the same form as the insurance reminder email). */
export const insuranceDate = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");

/** One row's status line and whether it is a problem (pink). Expired wins over everything; unchecked uploads say so. */
export function insuranceRowStatus(c: { verified: boolean; expires: string | null }, now = new Date()): { line: string; warn: boolean } {
  if (c.expires) {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (new Date(`${c.expires.slice(0, 10)}T00:00:00Z`).getTime() < today) return { line: INSURANCE_PAGE_WORDS.expired(insuranceDate(c.expires)), warn: true };
  }
  if (!c.verified) return { line: INSURANCE_PAGE_WORDS.waiting, warn: true };
  return c.expires ? { line: INSURANCE_PAGE_WORDS.checkedUntil(insuranceDate(c.expires)), warn: false } : { line: INSURANCE_PAGE_WORDS.checkedNoDate, warn: true };
}

/** Row names as Jo wrote them ("Public liability", "Workers comp"); other kinds keep their stored label. */
export function insuranceRowLabel(kind: string | null | undefined, label: string): string {
  return ({ public_liability_insurance: "Public liability", workers_comp_insurance: "Workers comp", electrical_licence: "Electrical licence", installer_certification: "Installer certificate" } as Record<string, string>)[kind ?? ""] ?? label;
}
