// Safe Work Method Statement ("safety plan") for an install — decision 261 (Jo 24 Oct 2026). PURE: no database, no network.
// The SWMS is NOT on the Mitti form: the portal writes it from job facts, the crew read it and sign it on the installer's
// job page before install day, and the signed copy is filed in the WorkSafe Victoria sample-template layout
// (Safe-work-method-statements-2023-07). Legal minimum per docs/SWMS_REQUIREMENTS_VIC_2026-10-24.md (OHS Regs 2017
// r 326–328): high-risk construction work, hazards, control measures, how they are implemented, monitored and reviewed.
import { norm } from "./trade-shared-consts.core";
import { sha256Hex } from "./sha256.core";

// ── Jo 2 Nov 2026 (Part 7 Task 1): the approved wording — "Lead Installer" in full, hazard 9 and the downlight step as
// approved, people labelled "(Lead Installer)" / "(Crew)". It sits behind SWMS_NOV2_WORDING_ON because the hazard text is
// part of every plan's fingerprint: switching it on changes the rule and the fingerprint, so everyone signs again (the #48
// reminder text asks them). Part 11 turns it on only on a day with no real install within the next 48 hours. While it is
// false, every plan, SWMS_RULE and fingerprint stay byte-identical to the 24 Oct wording (tests/swms-wording-2nov.test.ts).
export const SWMS_NOV2_WORDING_ON = false as boolean;

export type SwmsRule = "swms-portal-2026-10-24" | "swms-portal-2026-11-02";
export type SwmsHazard = { name: string; short: string; control: string };
/** One wording set: the lines a plan carries or prints, chosen by its rule. */
export type SwmsWording = {
  rule: SwmsRule;
  complianceMeasures: string; howImplemented: string; review: string; howInPlace: string;
  hazards: readonly SwmsHazard[];
  /** Printed after a person's name on the sign-off lines and the Responsible column. */
  roleLabel: { lead: string; crew: string };
  /** swmsStatus missing line when no one is picked as the Lead Installer. */
  noLeadLine: string;
  /** swmsLeadPhoneBlocker: only the Lead Installer may open a crew member's own sign link on their phone. */
  leadPhoneOnlyLine: string;
};

/** The 24 Oct 2026 wording (decisions 256–261) — unchanged, so plans signed on it keep their fingerprint. */
const SWMS_WORDING_2026_10_24: SwmsWording = {
  rule: "swms-portal-2026-10-24",
  complianceMeasures: "Direct supervision by the lead installer; every control checked before first entry and at the start of each day",
  howImplemented: "Lead installer directly supervises the crew, checks the control before anyone enters the ceiling and again at the start of each day, and stops work if it cannot be followed",
  review: "The lead installer re-checks every control at the start of each day before work, and the plan is reviewed if anything on site changes",
  howInPlace: "How these are put in place: the lead installer directly supervises the crew, checks every control before anyone enters the ceiling and again at the start of each day, and stops work if any control cannot be followed.",
  /** The nine ESC hazards of every ceiling insulation job, each with its standard-controls sentence (decisions 256–261). */
  hazards: [
    { name: "Live electrical hazards", short: "Live electrical", control: "power isolated, locked out and tagged before entry (solar, battery and generator too, following their instructions); PIESA read and its conditions followed; electrician on site when the PIESA requires; test for dead before touching cables" },
    { name: "Hazardous substances (friable asbestos, harmful chemicals)", short: "Hazardous substances", control: "if asbestos is suspected, do not disturb it — stop work; it is a licensed asbestos removalist's job before work continues; no chemicals or solvents used in the ceiling" },
    { name: "Biological hazards (mould, animal waste)", short: "Biological (mould, animal waste)", control: "do not disturb droppings or mould dry; P2 mask and gloves; wash hands before eating" },
    { name: "High temperatures and heat exhaustion", short: "Heat", control: "work early, water and a break every 30 minutes, stop in extreme heat" },
    { name: "Unsafe noise and vibration levels", short: "Noise and vibration", control: "hearing protection for blowers and power tools" },
    { name: "Respiratory hazards and irritants (dust, odours)", short: "Dust and irritants", control: "P2 mask, goggles, gloves and long sleeves in the ceiling; removed material bagged in the ceiling" },
    { name: "Working in enclosed spaces", short: "Enclosed spaces", control: "exits kept clear, lighting set up first, stay in contact with someone outside the ceiling" },
    { name: "Working at height (inside and outside the ceiling space)", short: "Height (inside and outside the ceiling space)", control: "walk only on joists or crawl boards, never on plasterboard; ladder secured and footed with three points of contact; no roof access in wind or rain" },
    { name: "Fire hazards and ignition sources (flues, chimneys, gas heaters, heat lamps, exhaust fans, downlights, cables over 400 mm surrounded by insulation)", short: "Fire and ignition sources", control: "AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps, exhaust fans and downlights; cables over 400 mm in insulation as the PIESA directs" },
  ],
  roleLabel: { lead: "lead installer", crew: "installer" },
  noLeadLine: "No lead installer is chosen for this install",
  leadPhoneOnlyLine: "Only the lead installer can open someone's sign link on their phone.",
};

/** Jo 2 Nov 2026: hazards 1–8 are the same sentences with the first letter capitalised (in the constant, not at render);
 *  hazard 9 is the approved control (plan Global Constraints, verbatim; "IC‑4" carries a non-breaking hyphen). */
const SWMS_WORDING_2026_11_02: SwmsWording = {
  rule: "swms-portal-2026-11-02",
  complianceMeasures: "Direct supervision by the Lead Installer; every control checked before first entry and at the start of each day",
  howImplemented: "Lead Installer directly supervises the crew, checks the control before anyone enters the ceiling and again at the start of each day, and stops work if it cannot be followed",
  review: "The Lead Installer re-checks every control at the start of each day before work, and the plan is reviewed if anything on site changes",
  howInPlace: "How these are put in place: the Lead Installer directly supervises the crew, checks every control before anyone enters the ceiling and again at the start of each day, and stops work if any control cannot be followed.", // DRAFT (the 24 Oct line with "Lead Installer" in full)
  hazards: [
    { name: "Live electrical hazards", short: "Live electrical", control: "Power isolated, locked out and tagged before entry (solar, battery and generator too, following their instructions); PIESA read and its conditions followed; electrician on site when the PIESA requires; test for dead before touching cables" },
    { name: "Hazardous substances (friable asbestos, harmful chemicals)", short: "Hazardous substances", control: "If asbestos is suspected, do not disturb it — stop work; it is a licensed asbestos removalist's job before work continues; no chemicals or solvents used in the ceiling" },
    { name: "Biological hazards (mould, animal waste)", short: "Biological (mould, animal waste)", control: "Do not disturb droppings or mould dry; P2 mask and gloves; wash hands before eating" },
    { name: "High temperatures and heat exhaustion", short: "Heat", control: "Work early, water and a break every 30 minutes, stop in extreme heat" },
    { name: "Unsafe noise and vibration levels", short: "Noise and vibration", control: "Hearing protection for blowers and power tools" },
    { name: "Respiratory hazards and irritants (dust, odours)", short: "Dust and irritants", control: "P2 mask, goggles, gloves and long sleeves in the ceiling; removed material bagged in the ceiling" },
    { name: "Working in enclosed spaces", short: "Enclosed spaces", control: "Exits kept clear, lighting set up first, stay in contact with someone outside the ceiling" },
    { name: "Working at height (inside and outside the ceiling space)", short: "Height (inside and outside the ceiling space)", control: "Walk only on joists or crawl boards, never on plasterboard; ladder secured and footed with three points of contact; no roof access in wind or rain" },
    { name: "Fire hazards and ignition sources (flues, chimneys, gas heaters, heat lamps, exhaust fans, downlights, cables over 400 mm surrounded by insulation)", short: "Fire and ignition sources", control: "AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps and exhaust fans; downlights are IC or IC‑4 rated and insulated as rated; cables over 400 mm in insulation as the PIESA directs" },
  ],
  roleLabel: { lead: "Lead Installer", crew: "Crew" },
  noLeadLine: "No Lead Installer is chosen for this install", // DRAFT (the 24 Oct line with "Lead Installer" in full)
  leadPhoneOnlyLine: "Only the Lead Installer can open someone's sign link on their phone.",
};

/** The wording set in force: the 2 Nov set only while SWMS_NOV2_WORDING_ON (callers may override, e.g. tests and Part 11 checks). */
export function swmsWording(nov2: boolean = SWMS_NOV2_WORDING_ON): SwmsWording {
  return nov2 ? SWMS_WORDING_2026_11_02 : SWMS_WORDING_2026_10_24;
}
/** The wording set a plan was built on (by its rule), so a filed record always prints the words that were signed. */
export function swmsWordingFor(rule: SwmsRule): SwmsWording {
  return rule === SWMS_WORDING_2026_11_02.rule ? SWMS_WORDING_2026_11_02 : SWMS_WORDING_2026_10_24;
}
/** "(lead installer)" / "(installer)" today; "(Lead Installer)" / "(Crew)" on the 2 Nov wording. */
export function swmsRoleLabel(rule: SwmsRule, role: "lead" | "crew"): string {
  return swmsWordingFor(rule).roleLabel[role];
}

const W = swmsWording();
export const SWMS_RULE: SwmsRule = W.rule;
/** Principal contractor printed on every SWMS. */
export const SWMS_PREPARED_FOR = "Home Insulation Victoria (DC Construction Solutions Pty Ltd)";
export const SWMS_WORK_DEFAULT = "Ceiling insulation removal (if required) and installation of bulk ceiling insulation – VEU Activity 48";
export const SWMS_RECORD_TASK = "Ceiling insulation removal (if required) and installation in the ceiling space";
export const SWMS_COMPLIANCE_MEASURES = W.complianceMeasures;
export const SWMS_HOW_IMPLEMENTED = W.howImplemented;
export const SWMS_REVIEW = W.review;
export const SWMS_SIGN_STATEMENT = "I have read the safety plan and will follow it";
/** Approved (overview "Decided from earlier approvals", rule 12): printed under Compliance on every plan, whatever the rule. */
export const SWMS_LEAD_ON_SITE_LINE = "The Lead Installer is on site for the whole install.";

/** High-risk construction work types (OHS Regs r 5 list, the ones a ceiling insulation job can involve). */
export const SWMS_HRCW = {
  falls: "Risk of a person falling more than 2 metres (ladder, manhole, roof, ceiling joists)",
  electrical: "Work on or near energised electrical installations or services (ceiling cables, switchboard, solar/battery)",
  confined: "Work in or near a confined space",
  asbestos: "Work that may disturb asbestos (home built before 1990, or asbestos suspected)",
} as const;

/** The nine ESC hazards of every ceiling insulation job, each with its standard-controls sentence — the set in force. */
export const SWMS_HAZARDS: readonly SwmsHazard[] = W.hazards;
export const SWMS_HOW_IN_PLACE = W.howInPlace;
/** The standard-controls paragraph (job page + PDF). */
export const SWMS_STANDARD_CONTROLS_TEXT = ["Standard controls for the hazards of every ceiling insulation job.", ...SWMS_HAZARDS.map((h) => `${h.short}: ${h.control}.`), SWMS_HOW_IN_PLACE].join(" ");

export type SwmsPerson = { name: string; workerId: string | null };
export type SwmsFacts = {
  jobNumber: string; address: string | null; businessName: string | null; installDate: string | null;
  lead: SwmsPerson | null; crew: SwmsPerson[];
  /** properties.year_built (null = unknown). */
  yearBuilt: number | null;
  /** Ready Check / PIESA hazard note text (assessments.hazards). */
  hazardNote: string | null;
  /** Optional site note the crew adds on the job page. */
  siteNote: string | null;
  /** Jo 30 Oct 2026: house facts from the Ready Check and PIESA (swms-house.core), and their set safety steps. */
  houseLines?: string[];
  houseSteps?: string[];
};
export type SwmsSigner = { key: string; name: string; role: "lead" | "crew" };
export type SwmsPlan = {
  rule: SwmsRule; jobNumber: string; address: string | null; businessName: string | null; installDate: string | null;
  principalContractor: string; workActivity: string; highRiskWork: string[]; hazards: readonly SwmsHazard[]; siteNote: string | null; houseLines: string[]; houseSteps: string[]; signers: SwmsSigner[];
};
/** One recorded signature (append-only `swms_signed` workflow event). */
export type SwmsSignature = { key: string; name: string; typedName: string; signedAt: string; planSha?: string | null };

/** Jo 30 Oct 2026: the text whose sha256 fingerprints a plan version (signers left out, so adding a crew member doesn't
 *  void the others' signatures). Same text `signSwms` has always hashed into `plan_sha256`. */
export function swmsPlanFingerprintText(plan: SwmsPlan): string {
  return JSON.stringify({ ...plan, signers: undefined });
}
/** Jo 30 Oct 2026: a signature counts only for the plan version it was given on. */
export function currentSignatures(sigs: SwmsSignature[], planSha: string): SwmsSignature[] {
  return sigs.filter((s) => s.planSha === planSha);
}

export const swmsSignerKey = (p: SwmsPerson) => (p.workerId ? `w:${p.workerId}` : `n:${norm(p.name)}`);

/** Falls over 2 m and energised electrical always apply; asbestos when built before 1990 or a hazard note mentions it;
 *  confined space is never assumed (the site note covers an unusual ceiling). */
export function swmsHighRiskWork(f: Pick<SwmsFacts, "yearBuilt" | "hazardNote" | "siteNote">): string[] {
  const out: string[] = [SWMS_HRCW.falls, SWMS_HRCW.electrical];
  const asbestos = (f.yearBuilt != null && f.yearBuilt < 1990) || /asbestos/i.test(f.hazardNote ?? "") || /asbestos/i.test(f.siteNote ?? "");
  if (asbestos) out.push(SWMS_HRCW.asbestos);
  return out;
}

/** `opts.nov2` overrides SWMS_NOV2_WORDING_ON (tests, Part 11 checks); the rule and hazards come from that wording set. */
export function buildSwms(f: SwmsFacts, opts: { nov2?: boolean } = {}): SwmsPlan {
  const w = swmsWording(opts.nov2);
  const signers: SwmsSigner[] = [];
  const seen = new Set<string>();
  const push = (p: SwmsPerson | null, role: SwmsSigner["role"]) => {
    if (!p || !p.name.trim()) return;
    const key = swmsSignerKey(p);
    if (seen.has(key)) return;
    seen.add(key); signers.push({ key, name: p.name.trim(), role });
  };
  push(f.lead, "lead");
  for (const c of f.crew) push(c, "crew");
  return {
    rule: w.rule, jobNumber: f.jobNumber, address: f.address, businessName: f.businessName, installDate: f.installDate,
    principalContractor: SWMS_PREPARED_FOR, workActivity: SWMS_WORK_DEFAULT, highRiskWork: swmsHighRiskWork(f), hazards: w.hazards,
    siteNote: f.siteNote?.trim() ? f.siteNote.trim() : null, houseLines: [...(f.houseLines ?? [])], houseSteps: [...(f.houseSteps ?? [])], signers,
  };
}

/** Jo 30 Oct 2026: the "Specific to this house" lines — house facts, then set safety steps, then the installer's note.
 *  Empty = nothing known ("None recorded" is printed by the callers). */
export function swmsHouseSection(plan: Pick<SwmsPlan, "houseLines" | "houseSteps" | "siteNote">): string[] {
  return [...(plan.houseLines ?? []), ...(plan.houseSteps ?? []).map((s) => `Safety step: ${s}`), ...(plan.siteNote ? [plan.siteNote] : [])];
}

/** Latest signature per signer key (events in any order). */
export function latestSignatures(sigs: SwmsSignature[]): Map<string, SwmsSignature> {
  const m = new Map<string, SwmsSignature>();
  for (const s of [...sigs].sort((a, b) => Date.parse(a.signedAt) - Date.parse(b.signedAt))) m.set(s.key, s);
  return m;
}

export type SwmsStatus = { complete: boolean; missing: string[]; signed: SwmsSignature[] };
/** Complete = there is a lead and every listed person (lead + each crew member) has signed. */
export function swmsStatus(plan: SwmsPlan, sigs: SwmsSignature[]): SwmsStatus {
  const by = latestSignatures(sigs);
  const missing: string[] = [];
  if (!plan.signers.some((s) => s.role === "lead")) missing.push(swmsWordingFor(plan.rule).noLeadLine);
  for (const s of plan.signers) if (!by.has(s.key)) missing.push(s.name);
  return { complete: missing.length === 0, missing, signed: plan.signers.map((s) => by.get(s.key)).filter((x): x is SwmsSignature => !!x) };
}

/** Pre-start blocker line (prestart.core), null when signed. */
export function swmsBlocker(status: SwmsStatus | null | undefined): string | null {
  if (!status) return "Safety plan not signed: it has not been prepared for this install yet";
  return status.complete ? null : `Safety plan not signed: ${status.missing.join(", ")}`;
}

export type SwmsSignCheck = { ok: true; signer: SwmsSigner } | { ok: false; reason: string };
/** A person signs for themselves: their key must be on the plan, the typed name must be their name, and once only. */
export function checkSwmsSign(plan: SwmsPlan, sigs: SwmsSignature[], key: string, typedName: string): SwmsSignCheck {
  const signer = plan.signers.find((s) => s.key === key);
  if (!signer) return { ok: false, reason: "That person is not on this job's crew." };
  if (norm(typedName) !== norm(signer.name)) return { ok: false, reason: `Type ${signer.name}'s full name exactly to sign.` };
  if (latestSignatures(sigs).has(key)) return { ok: false, reason: `${signer.name} has already signed the safety plan.` };
  return { ok: true, signer };
}

/** Jo 2 Nov 2026 (Part 7 Task 1): the Compliance block as label/value lines — who is responsible, the measures and review
 *  lines of the plan's wording set, and always the approved "on site for the whole install" line. Task 2's PDF prints it. */
export function swmsComplianceLines(plan: SwmsPlan): [label: string, value: string][] {
  const w = swmsWordingFor(plan.rule);
  const lead = plan.signers.find((s) => s.role === "lead")?.name;
  return [
    ["Person responsible for ensuring compliance with SWMS", lead && lead.trim() ? lead.trim() : "—"],
    ["Measures to ensure compliance", w.complianceMeasures],
    ["How control measures will be reviewed", w.review],
    ["Supervision", SWMS_LEAD_ON_SITE_LINE], // DRAFT label (the line itself is approved)
  ];
}

/** The filed SWMS (6-year record) in the WorkSafe Victoria sample template layout, in the words of the plan's own rule. */
export function swmsRecordText(plan: SwmsPlan, sigs: SwmsSignature[]): string {
  const w = swmsWordingFor(plan.rule);
  const val = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");
  const by = latestSignatures(sigs);
  const lead = plan.signers.find((s) => s.role === "lead")?.name ?? null;
  const L: string[] = [];
  L.push("Safe Work Method Statement — ceiling insulation (VEU Activity 48)", `Job ${plan.jobNumber}`, "");
  L.push(
    `Direct employer: ${val(plan.businessName)}`,
    `Principal contractor: ${plan.principalContractor}`,
    `Work supervisor: ${val(lead)}`,
    `Site location/address: ${val(plan.address)}`,
    `Work activity: ${plan.workActivity}`,
    `Install date: ${val(plan.installDate)}`,
    `High-risk construction work: ${plan.highRiskWork.join("; ")}`,
    "",
    `Person responsible for ensuring compliance with SWMS: ${val(lead)}`,
    `Measures to ensure compliance: ${w.complianceMeasures}`,
    `How control measures will be reviewed: ${w.review}`,
    "",
    "Tasks | Hazard | Control measures | How implemented | Responsible",
  );
  for (const h of plan.hazards) L.push(`${SWMS_RECORD_TASK} | ${h.name} | ${h.short}: ${h.control}. | ${w.howImplemented} | ${val(lead)} (${w.roleLabel.lead})`);
  const house = swmsHouseSection(plan);
  L.push("", w.howInPlace, "", house.length > 1 ? ["Specific to this house:", ...house.map((x) => `- ${x}`)].join("\n") : `Specific to this house: ${house[0] ?? "None recorded"}`);
  L.push("", `Worker sign-off (${SWMS_SIGN_STATEMENT})`, "Name | Signature | Date");
  for (const s of plan.signers) {
    const g = by.get(s.key);
    L.push(`${s.name} (${w.roleLabel[s.role]}) | ${g ? `signed — typed "${g.typedName}"` : "NOT SIGNED"} | ${g ? g.signedAt : "—"}`);
  }
  return L.join("\n");
}

const SWMS_TZ = "Australia/Melbourne";
/** Decision 358: a signature time on the filed SWMS — DD/MM/YYYY h:mma, Melbourne time (e.g. 02/11/2026 7:00pm). */
export function swmsDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: SWMS_TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t))) p[x.type] = x.value;
  const h24 = Number(p["hour"]) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${p["day"]}/${p["month"]}/${p["year"]} ${h12}:${p["minute"]}${h24 < 12 ? "am" : "pm"}`;
}
/** Decision 358: the install date (YYYY-MM-DD, already a Melbourne day) as DD/MM/YYYY; anything else is printed as stored. */
export function swmsDate(ymd: string | null | undefined): string {
  if (!ymd || !ymd.trim()) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd.trim();
}

// ── Decision 364 (Jo 25 Oct 2026): each person signs on their OWN phone. ──
/** How a signature was given: logged in to the portal as that worker, or through that person's own secure text link. */
/** Jo 30 Oct 2026: "lead_phone" = that person's own link, opened on the Lead's phone (their own phone was dead). */
export type SwmsSignMethod = "login" | "link" | "lead_phone";
/** A logged-in person may sign only a line whose key is one of their own worker keys (`w:<partner_workers.id>`). */
export function swmsOwnLineBlocker(plan: SwmsPlan, key: string, ownKeys: readonly string[]): string | null {
  const signer = plan.signers.find((s) => s.key === key);
  if (!signer) return "That person is not on this job's crew.";
  return ownKeys.includes(key) ? null : `Only ${signer.name} can sign their own line.`;
}
/** Jo 30 Oct 2026: the Lead may open another unsigned person's own sign link on the Lead's phone. Null = allowed. */
export function swmsLeadPhoneBlocker(plan: SwmsPlan, sigs: SwmsSignature[], key: string, myKeys: readonly string[]): string | null {
  const signer = plan.signers.find((s) => s.key === key);
  if (!signer) return "That person is not on this job's crew.";
  const lead = plan.signers.find((s) => s.role === "lead");
  if (!lead || !myKeys.includes(lead.key)) return swmsWordingFor(plan.rule).leadPhoneOnlyLine;
  if (key === lead.key) return "Sign your own line with the Sign button.";
  if (latestSignatures(sigs).has(key)) return `${signer.name} has already signed.`;
  return null;
}
/** What the job-page card shows on one sign-off line for this viewer. */
export function swmsLineView(signer: SwmsSigner, signed: boolean, ownKeys: readonly string[], editable: boolean): { kind: "signed" } | { kind: "sign" } | { kind: "waiting"; text: string } | { kind: "closed" } {
  if (signed) return { kind: "signed" };
  if (!editable) return { kind: "closed" };
  return ownKeys.includes(signer.key) ? { kind: "sign" } : { kind: "waiting", text: `Waiting for ${signer.name}` };
}
/** Unsigned people on the plan (lead first), for the per-person sign links in the install texts. */
export function swmsUnsignedSigners(plan: SwmsPlan, sigs: SwmsSignature[]): SwmsSigner[] {
  const by = latestSignatures(sigs);
  return plan.signers.filter((s) => !by.has(s.key));
}

/** A change during the job (Jo 2 Nov, answer 16): what came up, what was done about it, who recorded it, and when (ISO). */
export type SwmsChange = { what: string; control: string; by: string; at: string };
/** Stable key of a set of changes ("" = none), so the SWMS is re-filed once per distinct set. */
export function swmsChangesKey(changes: SwmsChange[]): string {
  if (!changes.length) return "";
  return sha256Hex(JSON.stringify(changes.map((c) => [c.what, c.control, c.by, c.at]))).slice(0, 32);
}
