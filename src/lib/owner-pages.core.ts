// Wording for Jo's approved owner/installer PAGES (24 Oct 2026, decisions 125–130 and 137). PURE: labels and
// formatting only. Source of truth: docs/templates/owner/P1…P4, P6 and docs/templates/installer/P5 HTML mock-ups — copied byte-for-byte (Jo rejects
// paraphrases). Nothing here decides workflow, prices, eligibility or access: pages pass in facts they already have.

/* ---------- Shared ---------- */
export const OWNER_PAGE_FOOTER = "Home Insulation Victoria · VEU Accredited Person A003654 · DC Construction Solutions Pty Ltd · ABN 44 671 613 979";
export const OFFICE_EMAIL = "info@homeinsulationvictoria.com.au";

const MEL = "Australia/Melbourne";
/** "24 October 2026" (Melbourne day). */
export const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: MEL });
/** "28 October" (Melbourne day). */
export const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", timeZone: MEL });
/** "Tuesday 11 November" (Melbourne day). */
export const weekdayDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: MEL });
/** "7:30am" (Melbourne time). */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: MEL }).replace(/\s/g, "").toLowerCase();
/** "$1,850" when whole dollars, else "$185.10" — the approved pages write rebates and the $349 without cents. */
export const shortAud = (n: number) => Number.isInteger(Math.round(n * 100) / 100) && Math.round(n) === n ? `$${n.toLocaleString("en-AU")}` : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "$2,200.00" — the approved price lines always show cents. */
export const centsAud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---------- P1: three questions (decision 84 + approved page) ---------- */
export const P1 = {
  kicker: (first: string | null) => `ALMOST THERE${first ? `, ${first.toUpperCase()}` : ""}`,
  title: "Answer 3 quick questions to save your spot",
  sub: (rebate: string | null) => `Just tap. It takes under a minute.${rebate ? ` Your ${rebate} rebate is waiting.` : ""}`,
  question: (i: number) => `QUESTION ${i} OF 3`,
  /** Page titles for the three questions (the stored question keys and options are unchanged). */
  labels: { insulation_type: "What type is your insulation?", insulation_thickness: "About how thick is it?", house_built_period: "When was your home built?" } as Record<string, string>,
  photosTitle: "Got photos or a video? (optional)",
  photosSub: "It helps us check your insulation. Only if it's safe: hold your phone up through the ceiling hatch. Please don't climb into the roof space.",
  addPhotos: "Add photos",
  addVideo: "Add a video",
  save: "Save my free spot",
  saving: "Saving…",
  /** Amber line under the locked button, e.g. "Answer question 3 to save your spot". */
  lockHint: (unanswered: string) => `Answer ${unanswered} to save your spot`,
  noObligation: "No payment · no obligation",
  notInterested: "No longer interested",
} as const;

/* ---------- P2: quote + acceptance (decisions 126/127) ---------- */
export const P2 = {
  kicker: "YOUR QUOTE",
  title: (first: string | null) => (first ? `Hi ${first}, here's your quote` : "Here's your quote"),
  /** "824 High Street Road… · Measured at your Ready Check on 28 October · Price held until 7 November 2026" */
  sub: (x: { address: string | null; measuredOn: string | null; heldUntil: string | null }) =>
    [x.address, x.measuredOn ? `Measured at your Ready Check on ${x.measuredOn}` : "Measured at your Ready Check", x.heldUntil ? `Price held until ${x.heldUntil}` : null].filter(Boolean).join(" · "),
  rebateEyebrow: "Your VEU rebate",
  youSave: (rebate: string) => `You save ${rebate}`,
  rebateNote: "Taken off upfront. Nothing for you to claim.",
  priceEyebrow: "Your price",
  priceNote: "incl. GST · full price before rebate",
  measured: "Measured at your Ready Check",
  itemsTitle: "What you're paying for",
  fullPrice: "Full price", fullPriceSub: "incl. GST",
  rebateLine: "VEU rebate", rebateLineSub: "Taken off upfront, nothing to claim",
  youPay: "You pay",
  notIncluded: "Not included: electrical fixes, only if the safety check finds any. Quoted separately, nothing done without your OK.",
  sayYes: "SAY YES",
  twoThings: "Two quick things, then sign",
  tapEach: "Tap each one to read it in full. Plain English, no surprises.",
  tick1: "I accept this quote and the Customer Agreement",
  tick1Sub: (rebate: string) => `Your contract with Home Insulation Victoria for this job. The ${rebate} rebate comes off your price now; you'll sign the official rebate form after the install.`,
  tick1Read: "Read the agreement ›",
  tick2: "I've read my consumer rights and the payment terms",
  tick2Sub: (safetyCheck: string) => `${safetyCheck} now for the electrical safety check, 10% to book your install day, the rest on install day. Or pay in full any time.`,
  tick2Read: "Read in full ›",
  signTitle: "Sign",
  signSub: "Typing your name here is your signature. We record the time and the exact document you signed.",
  fullName: "Your full name",
  tick3: "I'm 18 or over, and I own this home or I'm authorised to sign for the owner",
  typeAgain: "Type your name again to sign",
  typeHere: "Type here",
  button: (safetyCheck: string) => `Sign and pay ${safetyCheck}`,
  signing: "Signing…",
  lockHint: "Tick all three and type your name to sign",
  payNote: (safetyCheck: string) => `Pay the ${safetyCheck} by card or bank transfer, no fees. You'll get your signed copy and invoice by email`,
  notForMe: "Not for me",
} as const;

/* ---------- P3: owner ESC consent (decision 128) ---------- */
export const P3 = {
  kicker: "STEP 1 OF 2 · BOOK YOUR INSTALL",
  /** "Tuesday 11 November, arriving 7:30am" */
  title: (startsAt: string) => `${weekdayDate(startsAt)}, arriving ${clock(startsAt)}`,
  sub: (deposit: string | null) => `To lock this in: sign the consent below${deposit ? `, then pay your 10% deposit (${deposit})` : ""}. Takes about a minute.`,
  whyLead: "Why we need this:",
  why: " the Victorian Government requires us to tell the Essential Services Commission about every insulation install before it happens, so safety regulators can check the work. This is your consent for us to share the details below with them. It's the Commission's own form.",
  formEyebrow: "OWNER'S CONSENT · ESSENTIAL SERVICES COMMISSION",
  section1: "Section 1: Information to be shared",
  rows: [["first_name", "First name"], ["last_name", "Last name"], ["installation_address", "Installation address"], ["phone", "Phone number"], ["email", "Email address"]] as const,
  wrong: "Something wrong?", correct: "Correct my details",
  section2: "Section 2: Declaration by owner",
  declare: "I declare that:",
  signLabel: "Owner signature: type your full name",
  typeHere: "Type here",
  dateLine: (today: string) => `Date: ${today} · Typing your name is your signature. We record the time and the exact form you signed, and email you a copy.`,
  button: "Sign and continue to deposit",
  signing: "Signing…",
  lockHint: "Tick all four and type your name to sign",
  afterNote: "Home Insulation Victoria signs Section 3 (our declaration that we explained this to you) and you get the completed form by email.",
} as const;
/** Approved page shows each Section 2 declaration as a sentence; the ESC record text is unchanged. */
export const sentence = (t: string) => (/[.]$/.test(t.trim()) ? t : `${t}.`);

/* ---------- P4: VEEC assignment signing (decision 129) ---------- */
export const P4 = {
  kicker: "ONE LAST THING",
  title: (first: string | null) => (first ? `Sign your rebate form, ${first}` : "Sign your rebate form"),
  intro: (x: { installedOn: string | null; rebate: string }) => `${x.installedOn ? `Your insulation was installed on ${x.installedOn}. ` : ""}This official form assigns the rebate you've already had off your price (${x.rebate}) to Home Insulation Victoria so we can claim it. Please check the details and sign. About a minute.`,
  rightsLead: "Your rights (Section 1):",
  rights: (rebate: string) => ` as the energy consumer, you own the right to create certificates for this upgrade. You're assigning that right to Home Insulation Victoria in return for the ${rebate} price reduction you've received. Any issues with the work: contact us first; unresolved issues can go to the Essential Services Commission at veu@esc.vic.gov.au. `,
  rightsRead: "Read Section 1 in full ›",
  formEyebrow: "VEEC ASSIGNMENT FORM · ACTIVITY 48 · CEILING INSULATION",
  section2: "Section 2: Activity and personnel details",
  wrong: "Something wrong?", tellUs: "Tell us before you sign",
  section4: "Section 4: Your declaration",
  declare: "I declare that:",
  tick: "I have read and make every declaration above",
  signLabel: "Consumer signature: type your full name",
  typeHere: "Type here",
  dateLine: (today: string) => `Date: ${today} · Typing your name is your signature. We record the time and the exact form you signed.`,
  button: "Sign my rebate form",
  signing: "Signing…",
  lockHint: "Tick the declaration and type your name to sign",
  afterNote: "Already signed by your installer and by Home Insulation Victoria. You'll get the completed copy by email straight away.",
  waitingInstaller: "Your installer signs their part first, then Home Insulation Victoria. We'll let you know the moment it's your turn.",
  waitingAp: "Home Insulation Victoria is signing its part. We'll let you know the moment it's your turn.",
} as const;
/** The "I declare that:" bullets out of the official Section 4 text (between "I declare that:" and the signature line). */
export function declarationBullets(section4: string): string[] {
  const lines = section4.split("\n").map((l) => l.trim());
  const start = lines.indexOf("I declare that:");
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) { if (!l || /^Consumer signature:/.test(l)) break; out.push(l); }
  return out;
}

/* ---------- P6: owner confirms the PIESA by secure link (decision 296, mock-up P6-piesa-confirm-page.html) ---------- */
export const P6 = {
  kicker: "YOUR ELECTRICAL SAFETY CHECK",
  title: "Your electrical safety check — please confirm",
  /** "Your electrician checked the wiring in your ceiling on 24 October 2026. Please confirm it was done …" */
  sub: (date: string) => `Your electrician checked the wiring in your ceiling on ${date}. Please confirm it was done — your install day can't be booked until you do. About a minute.`,
  whyLead: "Why we need this:",
  why: " the government's safety-check form has an owner's declaration. Normally you'd sign it on the electrician's tablet, but you don't have to be home for the check — so you confirm it here instead.",
  formEyebrow: "PRE-INSTALLATION ELECTRICAL SAFETY ASSESSMENT · OWNER'S DECLARATION",
  factsTitle: "What was done",
  rows: { date: "Assessment date", electrician: "Electrician", result: "Result" },
  warningLead: "Please don't let anyone into the ceiling before the install. ",
  declareTitle: "Your confirmation",
  declare: "By confirming you declare that:",
  signLabel: "Owner signature: type your full name",
  typeHere: "Type here",
  dateLine: (today: string) => `Date: ${today} · Typing your name is your signature. We record the time, your confirmation and the safety check it refers to.`,
  button: "Confirm my safety check",
  signing: "Confirming…",
  lockHint: "Tick the confirmation and type your name",
  afterNote: "Once you've confirmed, your installer can offer you install days inside the 30-day window.",
  /** After signing: "Confirmed on 24 October 2026" */
  confirmedTitle: "Electrical safety check: Confirmed ✓",
  confirmedOn: (date: string, name: string) => `Confirmed on ${date} by ${name}. Your installer can now offer you install days.`,
} as const;

/* ---------- P6F: the owner confirms the electrical fixes (decision 330; same page pattern as P6, no code) ---------- */
export const P6F = {
  kicker: "YOUR ELECTRICAL FIXES",
  title: "Your electrical fixes — please confirm",
  /** Decision 330 approved sentence: "{Electrician} finished the electrical fixes at your home on {date}. Please confirm on your job page. It takes a minute." */
  sub: (electrician: string, date: string) => `${electrician} finished the electrical fixes at your home on ${date}. Please confirm here. It takes a minute.`,
  formEyebrow: "PRE-INSTALLATION ELECTRICAL SAFETY ASSESSMENT · OWNER'S DECLARATION",
  declare: "By confirming you declare that:",
  signLabel: "Owner signature: type your full name",
  dateLine: (today: string) => `Date: ${today} · Typing your name is your signature. We record the time, your confirmation and the electrical fixes it refers to.`,
  button: "Confirm my electrical fixes",
  signing: "Confirming…",
  lockHint: "Tick the confirmation and type your name",
  confirmedTitle: "Electrical fixes: Confirmed ✓",
  confirmedOn: (date: string, name: string) => `Confirmed on ${date} by ${name}.`,
} as const;

/* ---------- P5: installer privacy notice (decision 130) ---------- */
export const P5 = {
  back: "‹ My business",
  title: "Privacy notice for your installers",
  sub: "The Essential Services Commission requires every installer to read this notice before we register them for the VEU program. Each person ticks their own name.",
  yourInstallers: "Your installers",
  /** "Acknowledged 24 Oct 2026, 2:15pm" */
  acknowledged: (iso: string) => `Acknowledged ${new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: MEL })}, ${clock(iso)}`,
  note: "Each person should tick their own box. We record the name, date and time, and email them a copy. Add a new installer under ",
  noteTeam: "My team",
  noteEnd: " and they'll see this notice first.",
  button: "Save acknowledgements",
  saving: "Saving…",
  leadSuffix: " (lead installer)",
} as const;

/* ---------- Decision 137: the 30-day clock ---------- */
export const THIRTY_DAY_CLOCK = {
  title: "⏰ The 30-day clock",
  lead: "Your install must happen within 30 days of this safety check.",
  body: " After 30 days the check expires and has to be done again, and a new check may be charged. So once it's done, please book your install day as soon as the installer offers times, and approve any electrical fixes quickly.",
  fixesLead: "Please approve this quickly.",
  /** Fixes-quote variant: "Your safety check expires 30 days after it was done (on 5 December), and the fixes and the install both need to happen before then. If it expires, a new safety check is needed and may be charged." */
  fixesBefore: " Your safety check expires 30 days after it was done (on ",
  fixesAfter: "), and the fixes and the install both need to happen before then. If it expires, a new safety check is needed and may be charged.",
} as const;
