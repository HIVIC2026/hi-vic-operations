// The electrician's next step on the no-login job link (new job flow, Part 6). Pure: facts in, one step out.
// Electricians never log in and never see a pay screen. Rules run from the end of the job back to the start,
// first match wins. The Part C lives in Mitti; only the Certificate of Electrical Safety is uploaded.
// TODO(join): WhoBooks comes from Part 5 `business-screen.core.ts`; it is not in this branch's base, so it is
// imported from where the same type lives today.
import type { WhoBooks } from "./installer-accepted-email.core";

export type { WhoBooks };

export type ElectricianLinkFacts = {
  whoBooks: WhoBooks;
  piesa: { start: string | null; formUrl: string | null; outcome: "pass" | "upgrades" | null; upgradesSameDay: boolean };
  upgrades: { start: string | null; formUrl: string | null; formDone: boolean };
  certificateIn: boolean;
  handedBack: boolean;
  now: Date;
};

export type ElectricianStep =
  | "book_piesa" | "waiting_office_book" | "piesa_day" | "set_upgrades_day" | "waiting_office_upgrades"
  | "upgrades_day" | "upload_certificate" | "all_done" | "closed";

export type ElectricianStepView = { step: ElectricianStep; title: string; sub: string | null; button: string | null; canBook: boolean };

/** Approved buttons: "Open safety check form", "Open upgrades form", "Enter day and time". Everything else is DRAFT (Jo has not approved the wording). */
export const ELECTRICIAN_LINK_WORDS: Record<ElectricianStep, { title: string; sub?: string; button?: string }> = {
  book_piesa: { title: "Book the safety check", button: "Enter day and time" },
  // DRAFT
  waiting_office_book: { title: "The office is booking the safety check", sub: "We'll let you know the day and time." },
  // DRAFT sub
  piesa_day: { title: "Safety check day", button: "Open safety check form" },
  // DRAFT button
  set_upgrades_day: { title: "When are you doing the upgrades?", button: "Enter the day" },
  // DRAFT
  waiting_office_upgrades: { title: "The office is booking the upgrades day", sub: "We'll let you know the day." },
  // DRAFT sub
  upgrades_day: { title: "Upgrades day", button: "Open upgrades form" },
  // DRAFT button
  upload_certificate: { title: "Upload the Certificate of Electrical Safety", button: "Upload the certificate" },
  // DRAFT
  all_done: { title: "All done", sub: "Nothing more to do on this job." },
  // DRAFT
  closed: { title: "This job has been handed back", sub: "There's nothing more to do here." },
};

/** Electrician link can book only when the installer's setting is electrician or either. */
export function canBookFromLink(whoBooks: WhoBooks): boolean {
  return whoBooks === "electrician" || whoBooks === "either";
}

/** "Fri 6 Nov, 10:00am" in Melbourne time. */
function dayTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`;
}

function view(step: ElectricianStep, canBook: boolean, sub?: string | null): ElectricianStepView {
  const w = ELECTRICIAN_LINK_WORDS[step];
  return { step, title: w.title, sub: sub ?? w.sub ?? null, button: w.button ?? null, canBook };
}

export function electricianStep(f: ElectricianLinkFacts): ElectricianStepView {
  const can = canBookFromLink(f.whoBooks);
  if (f.handedBack) return view("closed", false);
  if (f.certificateIn) return view("all_done", false);
  if (f.piesa.outcome === "pass") return view("all_done", false);
  if (f.piesa.outcome === "upgrades") {
    if (f.piesa.upgradesSameDay || f.upgrades.formDone) return view("upload_certificate", false);
    if (f.upgrades.start) return view("upgrades_day", false, dayTime(f.upgrades.start));
    return can ? view("set_upgrades_day", true) : view("waiting_office_upgrades", false);
  }
  if (f.piesa.start) return view("piesa_day", false, dayTime(f.piesa.start));
  return can ? view("book_piesa", true) : view("waiting_office_book", false);
}

// ---- The link itself (Task 2): lifetime, the text, and the plain messages -------------------------------------------
const DAY = 86_400_000;
/** After All done the link stays open this long (Jo's plan), then it expires. */
export const ELECTRICIAN_LINK_DAYS_AFTER_DONE = 14;
/** Before All done the link stays open: every open pushes the expiry this far out. */
export const ELECTRICIAN_LINK_OPEN_DAYS = 60;

/** `null` allDoneAt: now + 60 days (renewed on every open). After All done: allDoneAt + 14 days. */
export function electricianLinkExpiry(f: { allDoneAt: string | null; now: number }): string {
  if (f.allDoneAt) {
    const t = new Date(f.allDoneAt).getTime();
    if (!Number.isNaN(t)) return new Date(t + ELECTRICIAN_LINK_DAYS_AFTER_DONE * DAY).toISOString();
  }
  return new Date(f.now + ELECTRICIAN_LINK_OPEN_DAYS * DAY).toISOString();
}

/** The job-link text stays off until Jo approves the wording. */
export const ELECTRICIAN_LINK_TEXT_APPROVED = false as boolean;
export const ELECTRICIAN_LINK_SMS_TYPE = "electrician_job_link" as const;
export const electricianLinkTextKey = (jobId: string, workerId: string) => `electrician-link:v1:${jobId}:${workerId}`;

const tidy = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
/** DRAFT (no approved wording yet): "Home Insulation Victoria: New PIESA job HV-1234, Kew, for Smith Insulation. Your job link: https://…" */
export function electricianLinkText(i: { jobNumber: string; suburb: string | null; installer: string; url: string }): string {
  const suburb = tidy(i.suburb);
  return `Home Insulation Victoria: New PIESA job ${tidy(i.jobNumber)}${suburb ? `, ${suburb}` : ""}, for ${tidy(i.installer)}. Your job link: ${i.url}`;
}

/** DRAFT messages on a link that cannot be opened. */
export const electricianLinkSwitchedOff = (installer: string) => `This link has been switched off. Ask ${installer} for a new one.`;
export const electricianLinkExpired = (installer: string) => `This link has expired. Ask ${installer} for a new one.`;
export const ELECTRICIAN_LINK_NOT_VALID = "This link isn't valid.";
