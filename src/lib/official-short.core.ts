// Short onsite PIESA / PIISA (approved plan, 3 Oct 2026): clear full-sentence questions for Mitti.
// The electrician/installer answers these onsite; the portal expands them into every official
// March 2026 Word-form answer (official-expand.core.ts) and fills the official document
// (official-docx.core.ts). PURE: no I/O. Questions are full plain sentences — never shorthand.
import type { FormField } from "./mitti-forms.core";
import { B2_OPTIONS } from "./official-forms.core";

const yn = (id: string, label: string, when?: string): FormField => ({ id, label, type: "yesno", required: true, choices: ["Yes", "No"], ...(when ? { when } : {}), source: "short onsite form" });
const pre = (id: string, label: string, type: FormField["type"] = "text", when?: string): FormField => ({ id, label, type, required: true, prefill: true, ...(when ? { when } : {}), source: "portal prefill — signer confirms" });

// ---------- PIESA problem tick-lists (each a full sentence; mapped to official items in official-expand.core.ts) ----------
export const MAINS_PROBLEMS = [
  "The mains cable in the ceiling has not been identified and marked.",
  "The main switch is not accessible or does not work.",
  "The main switch cannot isolate all of the cables in the ceiling space safely.",
  "The main switch cannot be secured in the off position.",
  "Testing has not confirmed that the ceiling is dead when the main switch is off.",
  "Safety switches (RCDs) are missing for the circuits in the ceiling area.",
  "The safety switches (RCDs) have not been tested.",
] as const;
export const SOLAR_PROBLEMS = [
  "There are no instructions for safely shutting down and restarting the system.",
  "The isolator is not accessible, not working, or cannot be switched off safely.",
  "The system cables in the ceiling are not in conduit or are not clearly labelled.",
  "The system cables in the ceiling are not protected or supported where they could be damaged.",
] as const;
export const CEILING_PROBLEMS = [
  "There is electrically conductive conduit in the ceiling.",
  "The cables are not supported, or are run in a way that risks damage during the installation.",
  "Cables that will be surrounded by insulation do not meet the wiring rules for that situation.",
  "Thermoplastic (TPS) cables in the ceiling are deteriorated or damaged.",
  "Connections or terminations in the ceiling are exposed or not securely enclosed.",
  "Plug bases for lights or fans are loose in the ceiling.",
  "Foil-backed or electrically conductive insulation is present and has not been confirmed as not live.",
  "There are mains-connected cables in the ceiling that are not TPS.",
  "There is split metal conduit wiring in the ceiling.",
  "There are damaged or deteriorated cables in the ceiling.",
] as const;
export const RECTIFICATION_OUTCOMES = [
  "No repair work is needed",
  "Yes, repair work is needed",
  "Repair work is not possible, so an electrician must be present on installation day",
] as const;

/** Decision 323 (Jo 25 Oct 2026, replaces the conditional part of decision 312): the electrician confirms on EVERY A3
 *  (our leads and installer customers) that he won't discuss prices with the owner — a top-level Required tick on the
 *  Job page. The decision-312 question "Whose customer is this?" (and its portal prefill) is deleted; old forms that
 *  still carry it are read harmlessly (the answer is simply ignored). Office only — expandPiesa ignores the tick. */
export const CUSTOMER_OF_LEGACY_LABEL = "Whose customer is this?";
export const NO_PRICE_TALK_LABEL = "I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices.";
export const NO_PRICE_TALK_ISSUE = "Electrician hasn't confirmed they won't discuss prices with the owner";
/** Decision 323 office item: a COMPLETED A3 that carries the no-price tick item but it isn't ticked. Forms without the
 *  item (older templates) raise nothing; the job's channel no longer matters. Never a blocker for the official PIESA. */
export function noPriceTalkIssue(i: { completed: boolean; entries: { label: string; value: unknown }[] }): string | null {
  if (!i.completed) return null;
  const nrm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const first = (l: string) => nrm(String(l ?? "").split("\n")[0] ?? "");
  const tick = i.entries.find((e) => first(e.label) === nrm(NO_PRICE_TALK_LABEL));
  if (!tick) return null;
  const v = tick.value;
  const ok = v === true || /^(yes|true|ticked|checked)$/i.test(String(v ?? "").trim());
  return ok ? null : NO_PRICE_TALK_ISSUE;
}

/** Decision 309: the retired A3 question (old forms only). */
export const REPAIR_POSSIBLE_LEGACY_LABEL = "Can the repair work be done before installation?";
/** Derived marker: an old form said the repair could not be done before installation (decision 309 office flag). */
export const REPAIR_LEGACY_NOT_BEFORE = "rectificationLegacyNotBefore";
/** Decision 309 office flag (expandPiesa → sync review issues). */
export const REPAIR_LEGACY_NOT_BEFORE_FLAG = "Electrical fixes: this older form said the repair work can't be done before installation. Repairs now always happen before installation (decision 309) — check the fixes visit is booked.";

const LIFE_SUPPORT_RECORD = "Office life support record";
const LIFE_SUPPORT_CONFIRM = "Is the life support record shown above still correct?";
const LIFE_SUPPORT_WHEN = "Life support confirmed Yes";
/** Decision 294 (Jo 25 Oct 2026): the PIESA asks the fact directly; consent only when life support is present. */
export const LIFE_SUPPORT_PRESENT = "Is there life support equipment at the property?";
export const LIFE_SUPPORT_NOT_RECEIVED = "No – not received";
const LIFE_SUPPORT_PRESENT_WHEN = "Life support = Yes";
const LIFE_SUPPORT_CONSENT_WHEN = "Consent or medical plan received";

/** Short PIESA (electrician). Life support is confirmed against the enquiry record, never re-asked from scratch. */
/** Exact Mitti wording of the official Part 7 question (decision 210; docs/MITTI_PIESA_CHATGPT_PROMPT.md addendum). */
export const PIESA_EFFECTIVE_QUESTION = "Does the action you described effectively reduce the risk from each hazard listed?"; // retired by decision 295; read from old forms only
/** Decision 305 (Jo 25 Oct 2026): the electrician's ONE total price for the repair work (A3 Repair work page); what it
 *  covers is ticked (decision 308). Quote-only — never part of the official PIESA; the owner's fixes quote is built from these (fixes-price.core). */
export const FIXES_PRICE_LABEL = "Your total price for all the repair work, including GST";
/** Decision 305's free-text inclusions — retired by decision 308; read from old forms only (fallback), never asked. */
export const FIXES_INCLUDED_LABEL = "What's included in that price?";
export const FIXES_INCLUDED_HELP = "List each thing you'll do, e.g. replace 6 downlights with IC-4 LEDs, install 1 RCD.";
/** Decision 308 (Jo 25 Oct 2026: "No free text … the common things they will have to repair and an Other option"):
 *  tick-all list of what the price covers, with a count for downlights and RCDs and a description for Other. */
export const FIXES_WORK_LABEL = "What will you do? Tick everything included in your price.";
export const FIXES_WORK_OPTIONS = [
  "Replace downlights with IC-4 rated LED downlights",
  "Install RCD safety switches",
  "Upgrade circuit protection (breakers) for insulation",
  "Replace old cables with TPS cable",
  "Secure and support loose cables in the ceiling",
  "Repair or replace damaged connections or junction boxes",
  "Identify and mark the mains cable in the ceiling",
  "Remove or make safe old unused cables",
  "Label and protect solar or battery cables in the ceiling",
  // Decision 338 (Jo 25 Oct 2026): "Be on site at the start of the install day" left this list and is its own Yes/No
  // question (ONSITE_START_LABEL); an old form's tick is still read (FIXES_WORK_READ_OPTIONS).
  "Other",
] as const;
export const FIXES_DOWNLIGHT_OPTION = FIXES_WORK_OPTIONS[0];
export const FIXES_RCD_OPTION = FIXES_WORK_OPTIONS[1];
export const FIXES_OTHER_OPTION = FIXES_WORK_OPTIONS[9];
/** Decision 314 tick, retired from the list by decision 338: read from old forms only (and used as the quote-line wording
 *  when the decision-338 question is answered Yes). Same meaning: the official "electrician present at the start of
 *  installation" outcome, priced inside the one total; decision 327 lines the electrician up once the day is booked. */
export const FIXES_ONSITE_OPTION = "Be on site at the start of the install day";
/** Every option the portal READS from "What will you do?", in the old form order (the decision-338 list + the legacy tick). */
export const FIXES_WORK_READ_OPTIONS = [...FIXES_WORK_OPTIONS.slice(0, 9), FIXES_ONSITE_OPTION, FIXES_OTHER_OPTION] as const;
export type FixesWorkOption = (typeof FIXES_WORK_READ_OPTIONS)[number];
/** Decision 338 (Jo 25 Oct 2026): its own A3 question on the Repair work page (Yes = red, No = green), shown when repair work
 *  is needed, right after "Describe the other work" and before the total price. Yes = exactly what the old tick meant. */
export const ONSITE_START_LABEL = "Does an electrician need to be on site at the start of the install?";
/** Decision 338 office flag: repair work needed, but nothing ticked and no on-site attendance. */
export const NO_REPAIR_WORK_FLAG = "No repair work ticked and no on-site attendance";
/** Decision 314 record (history only since decision 327: no Needs me line — the electrician is asked automatically once the
 *  install day is booked, install-attendance.core). */
export const ONSITE_START_EVENT = "electrician_onsite_install_start";
export const ONSITE_START_CLEARED_EVENT = "electrician_onsite_install_start_cleared";
export const ONSITE_START_HISTORY_TEXT = "The safety check says the electrician must be on site at the start of the install day — they are asked to confirm automatically once the day is booked";

const nrmTick = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The ticked decision-308/314 options, in form order. Mitti joins multi-select labels with ", " (the portal also accepts
 *  " | ", new lines, ";" and arrays). Known options are matched by their full wording; "Other" only as its own answer. */
export function fixesWorkTicks(raw: unknown): string[] {
  const parts = (Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : []).flatMap((x) => x.split(/\s*(?:\||\n|;)\s*/));
  const joined = ` ${nrmTick(parts.join(" , "))} `;
  const tokens = parts.flatMap((x) => x.split(/\s*,\s*/)).map(nrmTick).filter(Boolean);
  return FIXES_WORK_READ_OPTIONS.filter((o) => (o === FIXES_OTHER_OPTION ? tokens.some((t) => t === "other" || t.startsWith("other ")) : joined.includes(` ${nrmTick(o)} `)));
}
/** Decision 338: the A3 answered "Does an electrician need to be on site at the start of the install?" = Yes. */
const onsiteQuestionYes = (short: Record<string, unknown>): boolean => /^\s*yes\b/i.test(String(short["onsiteStartNeeded"] ?? ""));
/** Decisions 314/338: the electrician must be on site at the start of the install day — the decision-338 question = Yes, or
 *  (old forms) the retired "Be on site at the start of the install day" tick. */
export const onsiteStartTicked = (short: Record<string, unknown>): boolean => onsiteQuestionYes(short) || fixesWorkTicks(short["fixesWork"]).includes(FIXES_ONSITE_OPTION);
/** The ticks plus the on-site attendance (a decision-338 Yes adds the legacy tick's wording before "Other"), so the quote line
 *  and every reader treat the new question exactly like the old tick. */
export function fixesWorkWithOnsite(short: Record<string, unknown>): FixesWorkOption[] {
  const t = fixesWorkTicks(short["fixesWork"]) as FixesWorkOption[];
  if (!onsiteQuestionYes(short) || t.includes(FIXES_ONSITE_OPTION)) return t;
  return FIXES_WORK_READ_OPTIONS.filter((o) => o === FIXES_ONSITE_OPTION || t.includes(o));
}
/** Decision 314: repair work other than being on site at the start (needs the A4 fixes visit). An answer from before
 *  decision 308 (no ticks and no on-site attendance) counts as repair work, as before. */
export const repairWorkBesidesOnsite = (short: Record<string, unknown>): boolean => {
  const t = fixesWorkWithOnsite(short);
  return t.length === 0 || t.some((x) => x !== FIXES_ONSITE_OPTION);
};
/** Decision 324: the A3 questions that asked the official B2 ticks directly — retired, read from old forms only. */
export const REPAIR_TICKS_LEGACY_LABEL = "Please tick the repair work that is required.";
export const REPAIR_OTHER_LEGACY_LABEL = "Please describe the other repair work.";
/** Decision 324: each plain repair tick → its official PIESA B2 tick. `B2_OPTIONS[5]` ("Other (indicate below):") items add
 *  their plain name to the B2 other details; "Be on site at the start of the install day" adds no B2 tick (decision 314:
 *  it sets the electrician-present outcome instead). */
export const FIXES_TO_B2: Record<FixesWorkOption, string | null> = {
  "Replace downlights with IC-4 rated LED downlights": B2_OPTIONS[0],
  "Install RCD safety switches": B2_OPTIONS[2],
  "Upgrade circuit protection (breakers) for insulation": B2_OPTIONS[1],
  "Replace old cables with TPS cable": B2_OPTIONS[3],
  "Secure and support loose cables in the ceiling": B2_OPTIONS[4],
  "Repair or replace damaged connections or junction boxes": B2_OPTIONS[4],
  "Identify and mark the mains cable in the ceiling": B2_OPTIONS[5],
  "Remove or make safe old unused cables": B2_OPTIONS[4],
  "Label and protect solar or battery cables in the ceiling": B2_OPTIONS[5],
  "Be on site at the start of the install day": null,
  "Other": B2_OPTIONS[5],
};
/** Decision 324 (pure): the official B2 ticks (in the official order) and "Other (indicate below)" details derived from the
 *  plain list — the plain names of the Other-mapped items, then the electrician's "Describe the other work" text. */
export function derivedRepairTicks(short: Record<string, unknown>): { work: string[]; other: string } {
  const ticks = fixesWorkTicks(short["fixesWork"]) as FixesWorkOption[];
  const mapped = new Set(ticks.map((t) => FIXES_TO_B2[t]).filter((x): x is string => !!x));
  const work = B2_OPTIONS.filter((o) => mapped.has(o));
  const otherDesc = String(short["fixesOtherDetail"] ?? "").trim();
  const named: string[] = ticks.filter((t) => FIXES_TO_B2[t] === B2_OPTIONS[5] && t !== FIXES_OTHER_OPTION);
  const other = [...named, ...(ticks.includes(FIXES_OTHER_OPTION) && otherDesc ? [otherDesc] : [])].join("; ");
  return { work, other };
}
/** Decision 324: fills `rectificationWork` (" | "-joined official B2 wording) and `rectificationOther` from the plain list.
 *  An old form that answered the official ticks keeps them exactly as before (nothing is derived over them). */
export function deriveOfficialRepairTicks(out: Record<string, string>): void {
  if (String(out["rectificationWork"] ?? "").trim()) return;
  const { work, other } = derivedRepairTicks(out);
  if (!work.length) return;
  out["rectificationWork"] = work.join(" | ");
  if (other && !String(out["rectificationOther"] ?? "").trim()) out["rectificationOther"] = other;
}
export const FIXES_DOWNLIGHT_COUNT_LABEL = "How many downlights are you replacing?";
/** Decision 329: stored-answer labels for the A4 fixes form's signature (portal only, never on a Mitti form). */
export const FIXES_SIGNED_BY_LABEL = "Electrical fixes form signed by";
export const FIXES_SIGNED_ON_LABEL = "Electrical fixes form signed on";
export const FIXES_RCD_COUNT_LABEL = "How many RCD safety switches are you installing?";
export const FIXES_OTHER_LABEL = "Describe the other work";
export const FIXES_OTHER_HELP = "Say exactly what you'll do, where, and how many.";
/** Decision 295: the repeating "Add an appliance or flue" block on the PIESA (A3). */
export const APPLIANCE_BLOCK = "Add an appliance or flue";
/** Decision 336 (Jo 25 Oct 2026): the parent question now covers other hazards too; the decision-295 wording is still read. */
export const APPLIANCE_PRESENT_LABEL = "Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?";
export const APPLIANCE_PRESENT_LEGACY_LABEL = "Are there any appliances, exhaust fans or flues in the ceiling space?";
/** Decision 336: the questions inside the block, in form order (exact wording given to Jo). `problem` / `action` only when
 *  `safe` = No. */
export const APPLIANCE_Q = {
  type: "What type is it?",
  what: "What is it?",
  where: "Where is it?",
  photo: "Photo of it",
  safe: "Can insulation be safely installed around it as it is?",
  problem: "What is the problem?",
  action: "What needs to be done to make it safe?",
} as const;
/** Decision 336: "What type is it?" options — Flue rows answer the official flues question, Appliance / Exhaust fan rows the
 *  appliance table, Other hazard rows the official "other hazards" table (p7.otherHazard / p7.otherAction). */
export const APPLIANCE_TYPES = ["Appliance", "Exhaust fan", "Flue", "Other hazard"] as const;
export type ApplianceType = (typeof APPLIANCE_TYPES)[number];
/** Decision 295's single "What is it and where is it?" (old forms only): read as both What and Where. */
export const APPLIANCE_WHAT_WHERE_LEGACY_LABEL = "What is it and where is it?";
export type ApplianceRow = {
  /** Null on a decision-295 form (no type question) — that row keeps the old standard wording. */ type: ApplianceType | null;
  what: string; where: string; safe: "Yes" | "No" | null; photo: boolean; problem: string; action: string;
  /** A decision-295 row (no type / Where answer): Part 7 keeps the old standard wording for it. */ legacy: boolean;
};
/** The short-answer ids of the repeating block, in form order (rows are numbered by `shortAnswersFromEntries`). */
export const APPLIANCE_BLOCK_IDS = ["applianceType", "applianceWhat", "applianceWhatWhere", "applianceWhere", "appliancePhoto", "applianceSafe", "applianceProblem", "applianceAction"] as const;
const applianceType = (v: string): ApplianceType | null => APPLIANCE_TYPES.find((t) => t.toLowerCase() === v.trim().toLowerCase()) ?? null;
/** Every row the electrician added, in form order (applianceWhat, applianceWhat#1, …). */
export function applianceRows(short: Record<string, unknown>): ApplianceRow[] {
  const out: ApplianceRow[] = [];
  const get = (id: string, sfx: string) => String(short[`${id}${sfx}`] ?? "").trim();
  for (let i = 0; i < 50; i++) {
    const sfx = i === 0 ? "" : `#${i}`;
    const typeRaw = get("applianceType", sfx);
    const whatWhere = get("applianceWhatWhere", sfx);
    const what = get("applianceWhat", sfx) || whatWhere;
    const where = get("applianceWhere", sfx) || whatWhere;
    const safeRaw = get("applianceSafe", sfx);
    const photo = !!get("appliancePhoto", sfx);
    const problem = get("applianceProblem", sfx);
    const action = get("applianceAction", sfx);
    if (!typeRaw && !what && !where && !safeRaw && !photo && !problem && !action) { if (i > 0) break; continue; }
    const type = applianceType(typeRaw);
    const legacy = !typeRaw && !get("applianceWhere", sfx) && !problem && !action;
    out.push({ type, what, where: legacy ? "" : where, safe: /^yes/i.test(safeRaw) ? "Yes" : /^no/i.test(safeRaw) ? "No" : null, photo, problem, action, legacy });
  }
  return out;
}
export const SHORT_PIESA_FIELDS: FormField[] = [
  pre("jobRef", "Job Reference ID"),
  pre("address", "Address including postcode"),
  // Decision 323: Required on every job (no condition); "Whose customer is this?" (decision 312) is deleted.
  { id: "noPriceTalk", label: NO_PRICE_TALK_LABEL, type: "tick", required: true, source: "Home Insulation Victoria (decisions 312/323) – not part of the official form" },
  { id: "inspectionDate", label: "Date of inspection", type: "date", required: true, source: "short onsite form" },
  pre("lifeSupportRecord", LIFE_SUPPORT_RECORD),
  yn("lifeSupportPresent", LIFE_SUPPORT_PRESENT),
  { id: "lifeSupportConsent", label: "Have you received written consent or a medical plan? Please attach a photo of it.", type: "choice", required: true, choices: ["Yes – received Consent", "Yes – received Medical Plan", LIFE_SUPPORT_NOT_RECEIVED], when: LIFE_SUPPORT_PRESENT_WHEN, source: "short onsite form" },
  { id: "lifeSupportAttachment", label: "Written consent or medical plan (kept as an attachment to this assessment)", type: "media", required: true, when: LIFE_SUPPORT_CONSENT_WHEN, source: "short onsite form" },
  yn("mainsSafe", "Is the mains power set-up safe? This means the mains cable in the ceiling is identified and marked, the main switch works and can be locked off, the ceiling is confirmed dead when the switch is off, and safety switches (RCDs) are fitted and tested."),
  { id: "mainsProblems", label: "Please tick each item that is not right.", type: "multichoice", required: true, choices: [...MAINS_PROBLEMS], when: "mainsSafe = No", source: "short onsite form" },
  yn("solarPresent", "Is there solar, a battery or a generator at the property?"),
  yn("solarSafe", "Can it be safely shut down, and are its cables in the ceiling labelled, in conduit and protected?", "solarPresent = Yes"),
  { id: "solarProblems", label: "Please tick each item that is not right.", type: "multichoice", required: true, choices: [...SOLAR_PROBLEMS], when: "solarSafe = No", source: "short onsite form" },
  yn("ceilingSafe", "Are the cables, connections and fittings in the ceiling safe to work around and cover with insulation?"),
  { id: "ceilingProblems", label: "Please tick each problem you found.", type: "multichoice", required: true, choices: [...CEILING_PROBLEMS], when: "ceilingSafe = No", source: "short onsite form" },
  yn("downlightsPresent", "Are there any downlights or other recessed lights in the ceiling?"),
  { id: "downlightCount", label: "How many are there?", type: "number", required: true, when: "downlightsPresent = Yes", source: "short onsite form" },
  yn("downlightsNonIc", "Are any of them not IC or IC-4 rated?", "downlightsPresent = Yes"),
  // Jo 25 Oct 2026: the fixes quote needs the number of fittings to replace, not just that some are not IC rated.
  { id: "downlightsNonIcCount", label: "How many are not IC or IC-4 rated?", type: "number", required: true, when: "downlightsNonIc = Yes", source: "short onsite form" },
  // Decision 336 (Jo 25 Oct 2026): renamed to cover other hazards too; the decision-295 wording is still read (alias).
  { ...yn("appliancesPresent", APPLIANCE_PRESENT_LABEL), aliases: [APPLIANCE_PRESENT_LEGACY_LABEL] },
  // Decision 295 (Jo 25 Oct 2026): one repeating "Add an appliance or flue" block per item; the official Part 7 rows and
  // its "effective" tick are filled from these answers. Decision 336: type / what / where / photo / safe, then problem +
  // action when not safe — mapped row by row to Part 7 (official-expand). Repeats arrive as applianceWhat, applianceWhat#1, … (see
  // shortAnswersFromEntries). The old single description + self-grading question are read only from old forms.
  { id: "applianceType", label: APPLIANCE_Q.type, type: "choice", required: true, choices: [...APPLIANCE_TYPES], when: "appliancesPresent = Yes", source: "short onsite form (decision 336)" },
  { id: "applianceWhat", label: APPLIANCE_Q.what, type: "text", required: true, when: "appliancesPresent = Yes", source: "short onsite form (decision 336)" },
  // Decision 295's combined question (old forms only): read as both What and Where.
  { id: "applianceWhatWhere", label: APPLIANCE_WHAT_WHERE_LEGACY_LABEL, type: "text", required: false, portalOnly: true, when: "appliancesPresent = Yes", source: "LEGACY (decision 295, split by decision 336) – read from old forms only" },
  { id: "applianceWhere", label: APPLIANCE_Q.where, type: "text", required: true, when: "appliancesPresent = Yes", source: "short onsite form (decision 336)" },
  { id: "appliancePhoto", label: APPLIANCE_Q.photo, type: "media", required: true, when: "appliancesPresent = Yes", source: "short onsite form" },
  yn("applianceSafe", APPLIANCE_Q.safe, "appliancesPresent = Yes"),
  { id: "applianceProblem", label: APPLIANCE_Q.problem, type: "text", required: true, when: "applianceSafe = No", source: "short onsite form (decision 336) – official Part 7 Hazard" },
  { id: "applianceAction", label: APPLIANCE_Q.action, type: "text", required: true, when: "applianceSafe = No", source: "short onsite form (decision 336) – official Part 7 action" },
  // Jo 25 Oct 2026: Yes/No so Mitti can branch on it (a pick-one could not). The official outcome (`rectificationOutcome`,
  // RECTIFICATION_OUTCOMES) is DERIVED in shortAnswersFromEntries; an old form that answered the pick-one is still read.
  yn("rectificationNeeded", "Is any electrical repair work needed before insulation can be installed?"),
  // Decision 309 (Jo 25 Oct 2026: "Remove it"): repairs ALWAYS happen before installation (same visit or the A4 fixes visit),
  // so "Can the repair work be done before installation?" is no longer asked. LEGACY (portalOnly): an old form's "No" is still
  // read, mapped to the before-installation outcome and flagged for the office (deriveRectificationOutcome).
  { ...yn("rectificationPossible", REPAIR_POSSIBLE_LEGACY_LABEL, "rectificationNeeded = Yes"), required: false, portalOnly: true, source: "LEGACY (retired by decision 309) – read from old forms only" },
  // Decision 324 (Jo 25 Oct 2026: "the whole quoting part for electrician is clunky" → ONE list): the plain tick list, its
  // counts and the Other description, then the ONE total price LAST. The official B2 ticks + "Other (indicate below)" text
  // are DERIVED from the plain list (deriveOfficialRepairTicks); expandPiesa never reads the price.
  // Decision 338: not Required — empty is fine when the only work is being on site at the start (expandPiesa flags
  // NO_REPAIR_WORK_FLAG when both are empty).
  { id: "fixesWork", label: FIXES_WORK_LABEL, type: "multichoice", required: false, choices: [...FIXES_WORK_OPTIONS], when: "rectificationNeeded = Yes", source: "Home Insulation Victoria (decisions 308/324) – the official B2 ticks are derived from it" },
  { id: "fixesDownlightCount", label: FIXES_DOWNLIGHT_COUNT_LABEL, type: "number", required: true, when: `"${FIXES_DOWNLIGHT_OPTION}" is ticked`, source: "Home Insulation Victoria fixes quote (decision 308) – not part of the official form" },
  { id: "fixesRcdCount", label: FIXES_RCD_COUNT_LABEL, type: "number", required: true, when: `"${FIXES_RCD_OPTION}" is ticked`, source: "Home Insulation Victoria fixes quote (decision 308) – not part of the official form" },
  { id: "fixesOtherDetail", label: FIXES_OTHER_LABEL, type: "text", required: true, when: `"${FIXES_OTHER_OPTION}" is ticked in "${FIXES_WORK_LABEL}"`, source: "Home Insulation Victoria (decisions 308/324) – also the official B2 'Other' details" },
  // Decision 338 (Jo 25 Oct 2026): the decision-314 tick became its own question (Yes = red, No = green); Yes = the official
  // "electrician present at the start of installation" outcome, priced inside the one total below.
  { ...yn("onsiteStartNeeded", ONSITE_START_LABEL, "rectificationNeeded = Yes"), source: "Home Insulation Victoria (decision 338, replaces the decision-314 tick) – sets the official B1 outcome" },
  { id: "fixesPriceIncGst", label: FIXES_PRICE_LABEL, type: "number", required: true, when: "rectificationNeeded = Yes", source: "Home Insulation Victoria fixes quote (decisions 305/324: asked LAST) – not part of the official form" },
  // Decision 324: the official-wording ticks + other description are no longer asked. LEGACY (portalOnly): an old form's
  // answers are still read and, when present, used as the official B2 ticks exactly as before.
  { id: "rectificationWork", label: REPAIR_TICKS_LEGACY_LABEL, type: "multichoice", required: false, portalOnly: true, choices: [...B2_OPTIONS], when: "rectificationNeeded = Yes", source: "LEGACY (retired by decision 324) – read from old forms only" },
  { id: "rectificationOther", label: REPAIR_OTHER_LEGACY_LABEL, type: "text", required: false, portalOnly: true, when: "Other is ticked", source: "LEGACY (retired by decision 324) – read from old forms only" },
  // Decision 305's free-text inclusions: LEGACY — never asked on a new build (portalOnly), still read from old forms.
  { id: "fixesIncluded", label: FIXES_INCLUDED_LABEL, type: "text", required: false, portalOnly: true, when: "rectificationNeeded = Yes", source: "LEGACY (decision 305, retired by decision 308) – read from old forms only" },
  // Jo 25 Oct 2026 ("Full name and name???"): plain labels instead of the official form's; the portal pre-fills all five
  // and copies them into Section C itself, so the "after repair work" repeat (old 33–37) is gone from the Mitti form.
  pre("b3.licence", "Electrician licence number"),
  pre("b3.name", "Electrician full name"),
  pre("b3.recName", "Electrical contractor (REC) business name"),
  pre("b3.recNo", "REC registration number"),
  pre("b3.phone", "Electrician phone"),
  { id: "b3.declaration", label: "I declare that all information contained in and attached to this form is correct and not misleading by inclusion or omission", type: "tick", required: true, source: "DEECA PIESA form B3" },
  { id: "electricianSignature", label: "Electrician signature", type: "signature", required: true, source: "short onsite form" },
  // Decision 298 (Jo 25 Oct 2026): repair completion is never on the PIESA visit — these three come from the A4 fixes form
  // (fixes-day.core mergeFixesIntoPiesaSnapshot) or an old PIESA; kept here only so the stored answers still map. Not asked on A3.
  { ...yn("rectificationComplete", "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?", "rectificationNeeded = Yes"), required: false, source: "A4 fixes form (decision 298)" },
  { id: "coesNumber", label: "Certificate of Electrical Safety number (required for any electrical works completed):", type: "text", required: false, when: "rectificationNeeded = Yes", source: "A4 fixes form (decision 298)" },
  { id: "certDate", label: "Date of Certification:", type: "date", required: false, when: "rectificationNeeded = Yes", source: "A4 fixes form (decision 298)" },
  // Decision 329: who signed the A4 fixes form and when (Melbourne date) — written into the stored answers by
  // fixes-day.core mergeFixesIntoPiesaSnapshot and used for the official Section C typed signature. Never asked on A3.
  { id: "fixesSignedBy", label: FIXES_SIGNED_BY_LABEL, type: "text", required: false, portalOnly: true, when: "rectificationNeeded = Yes", source: "A4 fixes form signature (decision 329)" },
  { id: "fixesSignedOn", label: FIXES_SIGNED_ON_LABEL, type: "date", required: false, portalOnly: true, when: "rectificationNeeded = Yes", source: "A4 fixes form signature (decision 329)" },
  // Decision 296 (Jo 25 Oct 2026): the owner confirms the PIESA through their own secure link, not on the electrician's phone;
  // the owner block of the official form is filled from that record (official-expand ctx.ownerConfirmation).
];

/** Short PIISA (installer, installation day). PIESA answers are carried over from the signed PIESA, never re-asked. */
export const SHORT_PIISA_FIELDS: FormField[] = [
  pre("jobRef", "Job Reference ID"),
  pre("address", "Address including postcode"),
  pre("startDate", "Installation start date:", "date"),
  pre("completionDate", "Predicted installation completion date:", "date"),
  yn("powerInformed", "Has the household been told the power will be off during the installation?"),
  pre("lifeSupportRecord", LIFE_SUPPORT_RECORD),
  yn("lifeSupportConfirm", LIFE_SUPPORT_CONFIRM),
  { id: "lifeSupportConsent", label: "Have you received written consent or a medical plan? Please attach a photo of it.", type: "choice", required: true, choices: ["Yes – received Consent", "Yes – received Medical Plan"], when: LIFE_SUPPORT_WHEN, source: "short onsite form" },
  { id: "lifeSupportAttachment", label: "Written consent or medical plan (kept as an attachment to this assessment)", type: "media", required: true, when: LIFE_SUPPORT_WHEN, source: "short onsite form" },
  pre("p2.installDate", "Installation date:", "date"),
  pre("p2.ap", "Accredited person name:"),
  pre("p2.company", "Installer company name:"),
  pre("p2.lead", "Lead installer name:"),
  pre("p2.leadEec", "EEC certification number:"),
  ...[1, 2, 3].flatMap((n): FormField[] => [
    { id: `crewName${n}`, label: `Additional installer ${n} – full name`, type: "text", required: false, source: "short onsite form" },
    { id: `crewEec${n}`, label: `Additional installer ${n} – EEC certification number`, type: "text", required: false, when: `Additional installer ${n} named`, source: "short onsite form" },
  ]),
  yn("swmsComplete", "Has the Safe Work Method Statement been completed, have the common hazards been considered, and has the power been isolated, locked out and tagged?"),
  yn("piesaReviewed", "Have you read the Pre Insulation Electrical Safety Assessment (PIESA), and has nobody worked in the ceiling since it was done?"),
  yn("electricianHere", "The Pre Insulation Electrical Safety Assessment (PIESA) requires an electrician here at the start today. Is the electrician here?", "PIESA requires an electrician at the start"),
  yn("existingInsulation", "Is there existing insulation in the ceiling?"),
  { id: "insulationTreatment", label: "Will it be removed or topped up?", type: "choice", required: true, choices: ["Removed", "Topped Up"], when: "existingInsulation = Yes", source: "short onsite form" },
  { id: "insulationHeight", label: "What is its average height in millimetres?", type: "number", required: true, when: "existingInsulation = Yes", source: "short onsite form" },
  { id: "insulationRValue", label: "What is its R-value, if you know it?", type: "number", required: false, when: "existingInsulation = Yes", source: "short onsite form" },
  { id: "insulationReason", label: "Why is the existing insulation not being removed?", type: "text", required: true, when: "Topped Up", source: "short onsite form" },
  pre("p7.products", "List the insulation product(s) brand, model and R-value being installed"),
  { id: "p8.declaration", label: "All information contained in and attached to this form is correct and not misleading by inclusion or omission", type: "tick", required: true, source: "DEECA PIISA form Part 8" },
  { id: "installerSignature", label: "Installer signature", type: "signature", required: true, source: "short onsite form" },
  pre("p8.name", "Installer full name:"),
  { id: "p8.date", label: "Date:", type: "date", required: true, source: "short onsite form" },
];

export const SHORT_FIELDS: Record<"piesa" | "piisa", FormField[]> = { piesa: SHORT_PIESA_FIELDS, piisa: SHORT_PIISA_FIELDS };

/** Maps Mitti entries (by label) onto short-form ids. Duplicate labels are assigned in form order. */
export function shortAnswersFromEntries(key: "piesa" | "piisa", entries: { label: string; value: string | null }[]): Record<string, string> {
  const nrm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const fields = SHORT_FIELDS[key];
  const used = new Map<string, number>();
  const out: Record<string, string> = {};
  const formKey = key;
  let blockRow = -1;
  const blockSeen = new Set<string>();
  for (const e of entries) {
    const k = nrm(e.label ?? "");
    if (!k) continue;
    let cands = fields.filter((f) => nrm(f.label) === k || (f.aliases ?? []).some((a) => nrm(a) === k));
    // Mitti may append help text after a line break (decision 305's "What's included in that price?"): when the full label
    // matches nothing, the first line decides.
    if (!cands.length) {
      const first = nrm(String(e.label ?? "").split("\n")[0] ?? "");
      if (first && first !== k) cands = fields.filter((f) => nrm(f.label) === first);
    }
    if (!cands.length) continue;
    // Decision 336: the repeating hazard block is numbered by ROW (a new row starts when a question repeats), so "What is the
    // problem?" (asked only on unsafe rows) lands on its own row, never on an earlier safe one.
    if (formKey === "piesa" && (APPLIANCE_BLOCK_IDS as readonly string[]).includes(cands[0]!.id!)) {
      const id = cands[0]!.id!;
      if (blockRow < 0 || blockSeen.has(id)) { blockRow++; blockSeen.clear(); }
      blockSeen.add(id);
      if (e.value != null && e.value !== "") out[blockRow ? `${id}#${blockRow}` : id] = e.value;
      continue;
    }
    const key = nrm(cands[0]!.label);
    const seen = used.get(key) ?? 0;
    used.set(key, seen + 1);
    // A label that repeats more often than the form lists it (a repeating block, decision 295) keeps the LAST slot's id
    // with a #n suffix for each extra occurrence: applianceWhat, applianceWhat#1, applianceWhat#2 …
    const slot = cands[seen] ?? (cands.length ? { ...cands[cands.length - 1]!, id: `${cands[cands.length - 1]!.id}#${seen - cands.length + 1}` } : undefined);
    if (slot && e.value != null && e.value !== "") out[slot.id!] = e.value;
  }
  if (key === "piesa") { deriveOfficialRepairTicks(out); deriveRectificationOutcome(out); }
  return out;
}

/** The official outcome from the Yes/No answer (or the old pick-one answer, which arrives under the same label).
 *  Decision 309 (Jo 25 Oct 2026): repair needed → "Yes, repair work is needed" (before installation) — EXCEPT decision 314:
 *  when the electrician ticked "Be on site at the start of the install day" the outcome is the official third one
 *  (electrician present at the start of installation). An old form that said the repair could NOT be done before installation
 *  (the retired "No", or the old pick-one third option) is read as the same before-installation outcome and marked
 *  `REPAIR_LEGACY_NOT_BEFORE` so expandPiesa raises one office flag. */
export function deriveRectificationOutcome(out: Record<string, string>): void {
  const needed = String(out["rectificationNeeded"] ?? "").trim();
  if ((RECTIFICATION_OUTCOMES as readonly string[]).includes(needed)) {
    out["rectificationNeeded"] = needed === RECTIFICATION_OUTCOMES[0] ? "No" : "Yes";
    out["rectificationOutcome"] = needed === RECTIFICATION_OUTCOMES[0] ? RECTIFICATION_OUTCOMES[0] : RECTIFICATION_OUTCOMES[1];
    if (needed === RECTIFICATION_OUTCOMES[2]) { out["rectificationPossible"] = "No"; out[REPAIR_LEGACY_NOT_BEFORE] = "Yes"; }
    return;
  }
  if (/^no\b/i.test(needed)) out["rectificationOutcome"] = RECTIFICATION_OUTCOMES[0];
  else if (/^yes\b/i.test(needed)) {
    // Decision 314: "Be on site at the start of the install day" ticked = the official third outcome.
    if (onsiteStartTicked(out)) { out["rectificationOutcome"] = RECTIFICATION_OUTCOMES[2]; return; }
    out["rectificationOutcome"] = RECTIFICATION_OUTCOMES[1];
    if (/^no\b/i.test(String(out["rectificationPossible"] ?? ""))) out[REPAIR_LEGACY_NOT_BEFORE] = "Yes";
  }
}
