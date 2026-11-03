// Part 7 Task 3 (Jo 2 Nov 2026): the no-login SWMS signing page (/sp/<token>) — its words and the two small rules the
// page needs (title for tomorrow, the when-line, when the Sign button is allowed). PURE, no imports: the route must stay
// light on a weak phone signal. Approved wording from the plan (Task 3); anything else is marked DRAFT.
export type SwmsSignPageView = {
  jobNumber: string; address: string | null; installDate: string | null; installStart: string | null; businessName: string | null;
  /** The plan's rule: the page prints the words the person is signing (swmsWordingFor), never the module default. */
  rule: string; highRiskWork: string[]; hazards: { name: string; control: string }[]; howInPlace: string;
  siteNote: string | null; house: string[];
  signer: { name: string; role: "lead" | "crew" }; signedAt: string | null; open: boolean;
};

export const SIGN_PAGE_TEXT = {
  header: "Home Insulation Victoria · no login needed",
  ownLink: (name: string) => `Hi ${name} — your own link, only you can sign with it`, // DRAFT (the 25 Oct line reworded)
  titleTomorrow: "Safety plan for tomorrow",
  title: "Safety plan", // DRAFT (the title when the install isn't tomorrow)
  house: "Specific to this house",
  houseNone: "None recorded",
  controlsSummary: "The 9 standard controls", // DRAFT
  highRisk: "High-risk work on this job", // inside the fold only
  readPdf: "Read the full safety plan (PDF)",
  pdfBusy: "Getting the PDF…", // DRAFT
  pdfFailed: "The PDF didn't load. Check your connection and try again.", // DRAFT
  tick: (name: string, statement: string) => `I am ${name}. ${statement}.`,
  namePlaceholder: "Type your full name", // DRAFT
  sign: "Sign the safety plan",
  blockedTickAndName: "Tick the box and type your full name to sign.", // DRAFT
  blockedTick: "Tick the box to sign.", // DRAFT
  blockedName: "Type your full name to sign.", // DRAFT
  signing: "Signing…", // DRAFT
  signFailed: "Your signature wasn't saved. Check your connection and try again.",
  signed: "You've signed the safety plan.",
  closed: "The installation is recorded; the safety plan can't be signed now.",
} as const;

const TZ = "Australia/Melbourne";
const parts = (ms: number, o: Intl.DateTimeFormatOptions) => {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
};
/** Melbourne calendar date (YYYY-MM-DD) of an instant. */
function melbourneYmd(ms: number): string {
  const p = parts(ms, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}
function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "Safety plan for tomorrow" only when the install starts on the next Melbourne day; otherwise the plain title. */
export function signPageTitle(installStart: string | null, nowMs: number): string {
  const t = installStart ? Date.parse(installStart) : NaN;
  if (Number.isNaN(t)) return SIGN_PAGE_TEXT.title;
  return melbourneYmd(t) === nextYmd(melbourneYmd(nowMs)) ? SIGN_PAGE_TEXT.titleTomorrow : SIGN_PAGE_TEXT.title;
}

/** "7:30am" / "8am" Melbourne. */
function arrival(ms: number): string {
  const p = parts(ms, { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const h = Number(p["hour"]) % 24, m = Number(p["minute"]);
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}
/** The address without its postcode / state tail ("12 Example St, Box Hill VIC 3128" → "12 Example St, Box Hill"). */
export function addressForLine(address: string | null): string {
  return (address ?? "").trim().replace(/,?\s*(VIC\s*)?\d{4}\s*$/i, "").replace(/,\s*$/, "").trim();
}
/** "Fri 13 Nov, 7:30am · 12 Example St, Box Hill" (either half may be missing). */
export function signPageWhen(installStart: string | null, address: string | null): string {
  const t = installStart ? Date.parse(installStart) : NaN;
  const when = Number.isNaN(t) ? "" : (() => { const p = parts(t, { weekday: "short", day: "numeric", month: "short" }); return `${p["weekday"]} ${p["day"]} ${p["month"]}, ${arrival(t)}`; })();
  return [when, addressForLine(address)].filter(Boolean).join(" · ");
}

/** Why the Sign button is off (shown under it); null = may sign. */
export function signBlocker(ticked: boolean, typed: string): string | null {
  const named = typed.trim().length >= 2;
  if (!ticked && !named) return SIGN_PAGE_TEXT.blockedTickAndName;
  if (!ticked) return SIGN_PAGE_TEXT.blockedTick;
  if (!named) return SIGN_PAGE_TEXT.blockedName;
  return null;
}
