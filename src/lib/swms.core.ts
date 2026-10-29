// Safe Work Method Statement ("safety plan") for an install — decision 261 (Jo 24 Oct 2026). PURE: no database, no network.
// The SWMS is NOT on the Mitti form: the portal writes it from job facts, the crew read it and sign it on the installer's
// job page before install day, and the signed copy is filed in the WorkSafe Victoria sample-template layout
// (Safe-work-method-statements-2023-07). Legal minimum per docs/SWMS_REQUIREMENTS_VIC_2026-10-24.md (OHS Regs 2017
// r 326–328): high-risk construction work, hazards, control measures, how they are implemented, monitored and reviewed.
import { norm } from "./mitti.core";

export const SWMS_RULE = "swms-portal-2026-10-24";
/** Principal contractor printed on every SWMS. */
export const SWMS_PREPARED_FOR = "Home Insulation Victoria (DC Construction Solutions Pty Ltd)";
export const SWMS_WORK_DEFAULT = "Ceiling insulation removal (if required) and installation of bulk ceiling insulation – VEU Activity 48";
export const SWMS_RECORD_TASK = "Ceiling insulation removal (if required) and installation in the ceiling space";
export const SWMS_COMPLIANCE_MEASURES = "Direct supervision by the lead installer; every control checked before first entry and at the start of each day";
export const SWMS_HOW_IMPLEMENTED = "Lead installer directly supervises the crew, checks the control before anyone enters the ceiling and again at the start of each day, and stops work if it cannot be followed";
export const SWMS_REVIEW = "The lead installer re-checks every control at the start of each day before work, and the plan is reviewed if anything on site changes";
export const SWMS_SIGN_STATEMENT = "I have read the safety plan and will follow it";

/** High-risk construction work types (OHS Regs r 5 list, the ones a ceiling insulation job can involve). */
export const SWMS_HRCW = {
  falls: "Risk of a person falling more than 2 metres (ladder, manhole, roof, ceiling joists)",
  electrical: "Work on or near energised electrical installations or services (ceiling cables, switchboard, solar/battery)",
  confined: "Work in or near a confined space",
  asbestos: "Work that may disturb asbestos (home built before 1990, or asbestos suspected)",
} as const;

/** The nine ESC hazards of every ceiling insulation job, each with its standard-controls sentence (decisions 256–261). */
export const SWMS_HAZARDS: readonly { name: string; short: string; control: string }[] = [
  { name: "Live electrical hazards", short: "Live electrical", control: "power isolated, locked out and tagged before entry (solar, battery and generator too, following their instructions); PIESA read and its conditions followed; electrician on site when the PIESA requires; test for dead before touching cables" },
  { name: "Hazardous substances (friable asbestos, harmful chemicals)", short: "Hazardous substances", control: "if asbestos is suspected, do not disturb it — stop work; it is a licensed asbestos removalist's job before work continues; no chemicals or solvents used in the ceiling" },
  { name: "Biological hazards (mould, animal waste)", short: "Biological (mould, animal waste)", control: "do not disturb droppings or mould dry; P2 mask and gloves; wash hands before eating" },
  { name: "High temperatures and heat exhaustion", short: "Heat", control: "work early, water and a break every 30 minutes, stop in extreme heat" },
  { name: "Unsafe noise and vibration levels", short: "Noise and vibration", control: "hearing protection for blowers and power tools" },
  { name: "Respiratory hazards and irritants (dust, odours)", short: "Dust and irritants", control: "P2 mask, goggles, gloves and long sleeves in the ceiling; removed material bagged in the ceiling" },
  { name: "Working in enclosed spaces", short: "Enclosed spaces", control: "exits kept clear, lighting set up first, stay in contact with someone outside the ceiling" },
  { name: "Working at height (inside and outside the ceiling space)", short: "Height (inside and outside the ceiling space)", control: "walk only on joists or crawl boards, never on plasterboard; ladder secured and footed with three points of contact; no roof access in wind or rain" },
  { name: "Fire hazards and ignition sources (flues, chimneys, gas heaters, heat lamps, exhaust fans, downlights, cables over 400 mm surrounded by insulation)", short: "Fire and ignition sources", control: "AS 3999 clearances kept to flues, chimneys, gas heaters, heat lamps, exhaust fans and downlights; cables over 400 mm in insulation as the PIESA directs" },
];
export const SWMS_HOW_IN_PLACE = "How these are put in place: the lead installer directly supervises the crew, checks every control before anyone enters the ceiling and again at the start of each day, and stops work if any control cannot be followed.";
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
  rule: typeof SWMS_RULE; jobNumber: string; address: string | null; businessName: string | null; installDate: string | null;
  principalContractor: string; workActivity: string; highRiskWork: string[]; hazards: typeof SWMS_HAZARDS; siteNote: string | null; houseLines: string[]; houseSteps: string[]; signers: SwmsSigner[];
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

export function buildSwms(f: SwmsFacts): SwmsPlan {
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
    rule: SWMS_RULE, jobNumber: f.jobNumber, address: f.address, businessName: f.businessName, installDate: f.installDate,
    principalContractor: SWMS_PREPARED_FOR, workActivity: SWMS_WORK_DEFAULT, highRiskWork: swmsHighRiskWork(f), hazards: SWMS_HAZARDS,
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
  if (!plan.signers.some((s) => s.role === "lead")) missing.push("No lead installer is chosen for this install");
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

/** The filed SWMS (6-year record) in the WorkSafe Victoria sample template layout. */
export function swmsRecordText(plan: SwmsPlan, sigs: SwmsSignature[]): string {
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
    `Measures to ensure compliance: ${SWMS_COMPLIANCE_MEASURES}`,
    `How control measures will be reviewed: ${SWMS_REVIEW}`,
    "",
    "Tasks | Hazard | Control measures | How implemented | Responsible",
  );
  for (const h of plan.hazards) L.push(`${SWMS_RECORD_TASK} | ${h.name} | ${h.short}: ${h.control}. | ${SWMS_HOW_IMPLEMENTED} | ${val(lead)} (lead installer)`);
  const house = swmsHouseSection(plan);
  L.push("", SWMS_HOW_IN_PLACE, "", house.length > 1 ? ["Specific to this house:", ...house.map((x) => `- ${x}`)].join("\n") : `Specific to this house: ${house[0] ?? "None recorded"}`);
  L.push("", `Worker sign-off (${SWMS_SIGN_STATEMENT})`, "Name | Signature | Date");
  for (const s of plan.signers) {
    const g = by.get(s.key);
    L.push(`${s.name} (${s.role === "lead" ? "lead installer" : "installer"}) | ${g ? `signed — typed "${g.typedName}"` : "NOT SIGNED"} | ${g ? g.signedAt : "—"}`);
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
  if (!lead || !myKeys.includes(lead.key)) return "Only the lead installer can open someone's sign link on their phone.";
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
