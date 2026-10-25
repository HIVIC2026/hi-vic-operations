// Expands short onsite answers (official-short.core.ts) into every official March 2026 Word-form answer.
// PURE: no I/O. Rules:
// - A "yes, all safe" answer sets every matching official Yes/No. A "no" sets only the ticked problems.
// - Anything the portal can't fill for sure stays null and is listed in `flagged` for the office — never a guessed "No".
// - Life support comes from the enquiry record (confirmed onsite), never re-asked from scratch.
import { applianceRows } from "./official-short.core";
import { B1_OPTIONS, B2_OPTIONS, answerItems, type OfficialAnswers, type OfficialKey, type Value } from "./official-forms.core";
import { CEILING_PROBLEMS, MAINS_PROBLEMS, RECTIFICATION_OUTCOMES, SOLAR_PROBLEMS } from "./official-short.core";

export type ShortAnswers = Record<string, Value>;
export type ExpandContext = {
  /** Enquiry life-support answer ("yes"/"no"/"unknown"/null) — confirmed onsite by the signer. */
  lifeSupportDeclared: "yes" | "no" | "unknown" | null;
  /** Today (YYYY-MM-DD, Melbourne) for completion dates. */ today: string;
  /** Signed PIESA answers on the same job (PIISA expansion only). */ piesaAnswers?: OfficialAnswers | null;
  /** File id of the life-support consent/plan attached to the signed PIESA. */ piesaLifeSupportAttachment?: string | null;
  /** Accepted measure-up: existing insulation recorded? */ measuredInsulationPresent?: boolean | null;
};
export type ExpandResult = { answers: OfficialAnswers; flagged: string[] };

const txt = (v: Value) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)).trim();
const isYes = (v: Value) => /^yes$/i.test(txt(v));
const isNo = (v: Value) => /^no$/i.test(txt(v));
const ticked = (v: Value) => v === true || /^(yes|true|ticked|checked)$/i.test(txt(v));
const list = (v: Value) => (Array.isArray(v) ? v.map(String) : txt(v) ? txt(v).split(/\s*\|\s*/) : []);

/** Problem sentence → official item set to "No" (Part 2/3/4) or "Yes" (Part 5 hazard questions). */
const MAINS_MAP: Record<string, [string, "No"][]> = {
  [MAINS_PROBLEMS[0]]: [["p2.mains", "No"]],
  [MAINS_PROBLEMS[1]]: [["p2.switchAccessible", "No"]],
  [MAINS_PROBLEMS[2]]: [["p2.switchIsolates", "No"]],
  [MAINS_PROBLEMS[3]]: [["p2.switchSecured", "No"]],
  [MAINS_PROBLEMS[4]]: [["p2.tested", "No"]],
  [MAINS_PROBLEMS[5]]: [["p2.rcdPresent", "No"]],
  [MAINS_PROBLEMS[6]]: [["p2.rcdTested", "No"]],
};
const SOLAR_MAP: Record<string, [string, "No"][]> = {
  [SOLAR_PROBLEMS[0]]: [["p3.instructions", "No"]],
  [SOLAR_PROBLEMS[1]]: [["p3.isolator", "No"]],
  [SOLAR_PROBLEMS[2]]: [["p3.conduit", "No"]],
  [SOLAR_PROBLEMS[3]]: [["p3.protected", "No"]],
};
const CEILING_MAP: Record<string, [string, "Yes" | "No"][]> = {
  [CEILING_PROBLEMS[0]]: [["p4.conduit", "No"]],
  [CEILING_PROBLEMS[1]]: [["p4.supported", "No"]],
  [CEILING_PROBLEMS[2]]: [["p4.treatment", "No"]],
  [CEILING_PROBLEMS[3]]: [["p4.tps", "No"]],
  [CEILING_PROBLEMS[4]]: [["p4.terminations", "No"]],
  [CEILING_PROBLEMS[5]]: [["p4.plugBases", "No"]],
  [CEILING_PROBLEMS[6]]: [["p4.foil", "No"]],
  [CEILING_PROBLEMS[7]]: [["p5.nonTps", "Yes"]],
  [CEILING_PROBLEMS[8]]: [["p5.splitConduit", "Yes"]],
  [CEILING_PROBLEMS[9]]: [["p5.damaged", "Yes"]],
};

const copy = (out: OfficialAnswers, short: ShortAnswers, ids: string[]) => {
  for (const id of ids) if (txt(short[id])) out[id] = txt(short[id]);
};

export function expandPiesa(short: ShortAnswers, ctx: ExpandContext): ExpandResult {
  const out: OfficialAnswers = {};
  const flagged: string[] = [];
  copy(out, short, ["jobRef", "address", "inspectionDate", "b3.licence", "b3.name", "b3.recName", "b3.recNo", "b3.phone", "c.licence", "c.name", "c.recName", "c.recNo", "c.phone", "o.name", "o.date"]);

  // Life support (decision 294): the electrician answers the fact directly ("Is there life support equipment at the
  // property?"); consent/medical plan only when Yes, and "No – not received" is a stop. Older forms carried
  // "Is the life support record shown above still correct?" against the enquiry record — still read, never guessed.
  if (isYes(short["lifeSupportPresent"]) || isNo(short["lifeSupportPresent"])) {
    const present = isYes(short["lifeSupportPresent"]);
    out["lifeSupport"] = present ? "Yes" : "No";
    if (present) {
      const consent = txt(short["lifeSupportConsent"]);
      if (!consent) flagged.push("Life support: consent or medical plan answer missing.");
      else if (/^no\b/i.test(consent)) flagged.push("Life support: consent or medical plan NOT received — STOP, the office must resolve it before anything else happens on this job.");
      else out["lifeSupportConsent"] = consent;
      if (txt(short["lifeSupportAttachment"])) out["lifeSupportAttachment"] = txt(short["lifeSupportAttachment"]);
      else if (consent && !/^no\b/i.test(consent)) flagged.push("Life support: consent or medical plan attachment missing.");
    }
  } else if (isYes(short["lifeSupportConfirm"])) {
    if (ctx.lifeSupportDeclared === "yes" || ctx.lifeSupportDeclared === "no") {
      out["lifeSupport"] = ctx.lifeSupportDeclared === "yes" ? "Yes" : "No";
      if (ctx.lifeSupportDeclared === "yes") {
        if (txt(short["lifeSupportConsent"])) out["lifeSupportConsent"] = txt(short["lifeSupportConsent"]);
        else flagged.push("Life support: consent or medical plan answer missing.");
        if (txt(short["lifeSupportAttachment"])) out["lifeSupportAttachment"] = txt(short["lifeSupportAttachment"]);
        else flagged.push("Life support: consent or medical plan attachment missing.");
      }
    } else flagged.push("Life support: the enquiry has no clear answer — the office must confirm it.");
  } else if (isNo(short["lifeSupportConfirm"])) {
    flagged.push("Life support: the signer says the office record is wrong — the office must resolve it before the form can be filled.");
  } else flagged.push("Life support: not confirmed onsite.");

  // Part 2 mains: all safe → every item Yes; problems → only the ticked items No.
  const p2ids = ["p2.mains", "p2.switchAccessible", "p2.switchIsolates", "p2.switchSecured", "p2.tested", "p2.rcdPresent", "p2.rcdTested"];
  if (isYes(short["mainsSafe"]) || isNo(short["mainsSafe"])) {
    for (const id of p2ids) out[id] = "Yes";
    if (isNo(short["mainsSafe"])) for (const p of list(short["mainsProblems"])) for (const [id, v] of MAINS_MAP[p] ?? []) out[id] = v;
    out["p2.switch"] = ["p2.switchAccessible", "p2.switchIsolates", "p2.switchSecured"].some((k) => out[k] === "No") ? "No" : "Yes";
  } else flagged.push("Mains power: not answered.");

  // Part 3 solar.
  if (isYes(short["solarPresent"]) || isNo(short["solarPresent"])) {
    out["p3.present"] = isYes(short["solarPresent"]) ? "Yes" : "No";
    if (isYes(short["solarPresent"])) {
      if (isYes(short["solarSafe"]) || isNo(short["solarSafe"])) {
        for (const id of ["p3.instructions", "p3.isolator", "p3.conduit", "p3.protected"]) out[id] = "Yes";
        if (isNo(short["solarSafe"])) for (const p of list(short["solarProblems"])) for (const [id, v] of SOLAR_MAP[p] ?? []) out[id] = v;
      } else flagged.push("Solar/battery: shutdown safety not answered.");
    }
  } else flagged.push("Solar/battery: presence not answered.");

  // Parts 4 & 5 ceiling hazards.
  if (isYes(short["ceilingSafe"]) || isNo(short["ceilingSafe"])) {
    for (const id of ["p4.conduit", "p4.supported", "p4.treatment", "p4.tps", "p4.terminations", "p4.plugBases", "p4.foil"]) out[id] = "Yes";
    for (const id of ["p5.nonTps", "p5.splitConduit", "p5.damaged"]) out[id] = "No";
    if (isNo(short["ceilingSafe"])) for (const p of list(short["ceilingProblems"])) for (const [id, v] of CEILING_MAP[p] ?? []) out[id] = v;
  } else flagged.push("Ceiling cables and fittings: not answered.");

  // Part 6 downlights.
  if (isYes(short["downlightsPresent"]) || isNo(short["downlightsPresent"])) {
    out["p6.recessed"] = isYes(short["downlightsPresent"]) ? "Yes" : "No";
    if (isYes(short["downlightsPresent"])) {
      if (txt(short["downlightCount"])) out["p6.count"] = txt(short["downlightCount"]);
      else flagged.push("Downlights: count missing.");
      if (isYes(short["downlightsNonIc"]) || isNo(short["downlightsNonIc"])) out["p6.prohibited"] = isYes(short["downlightsNonIc"]) ? "Yes" : "No";
      else flagged.push("Downlights: IC / IC-4 rating not answered.");
    }
  } else flagged.push("Downlights: not answered.");

  // Part 7 appliances/flues (decision 295): one row per item from the repeating block; "safe as it is" = No means the work
  // sits under Part B2 repair work, so the official "effective" tick is Yes only when every item is safe, or once the
  // repair work is recorded complete. Old forms (one description + self-graded "effective") are still read.
  if (isYes(short["appliancesPresent"]) || isNo(short["appliancesPresent"])) {
    out["p7.appliances"] = isYes(short["appliancesPresent"]) ? "Yes" : "No";
    out["p7.flues"] = isYes(short["appliancesPresent"]) ? "Yes" : "No";
    if (isYes(short["appliancesPresent"])) {
      const rows = applianceRows(short);
      if (rows.length) {
        rows.slice(0, 10).forEach((r, i) => {
          out[`p7.appliance#${i}`] = r.what || "(not described)";
          out[`p7.location#${i}`] = r.what || "(not described)";
          out[`p7.hazard#${i}`] = r.safe === "Yes" ? "None — insulation can be installed around it as it is" : r.safe === "No" ? "Needs work or clearance before insulation (see Part B2 repair work)" : "Not assessed";
          if (!r.what) flagged.push(`Appliance ${i + 1}: not described.`);
          if (r.safe == null) flagged.push(`Appliance ${i + 1}: "safe as it is" not answered.`);
        });
        const unsafe = rows.filter((r) => r.safe === "No");
        out["p7.actions"] = unsafe.length ? "Work or clearance required before insulation — listed under Part B2 repair work" : "None required";
        if (rows.every((r) => r.safe === "Yes")) out["p7.effective"] = "Yes";
        else if (unsafe.length && isYes(short["rectificationComplete"])) out["p7.effective"] = "Yes";
        else if (unsafe.length) flagged.push("Appliances: work required before insulation — the official \"effective\" tick waits for the repair work to be recorded complete.");
      } else if (txt(short["applianceDetails"])) {
        out["p7.appliance#0"] = txt(short["applianceDetails"]);
        flagged.push("Appliances: the office must split the description into the official table (location, hazard, actions) before lodgement.");
        if (isYes(short["appliancesEffective"]) || isNo(short["appliancesEffective"])) out["p7.effective"] = isYes(short["appliancesEffective"]) ? "Yes" : "No";
        else flagged.push("Appliances: \"does the action effectively reduce the risk\" not answered.");
      } else flagged.push("Appliances: described as present but none listed.");
    }
  } else flagged.push("Appliances and flues: not answered.");

  // B1/B2 outcome.
  const outcome = txt(short["rectificationOutcome"]);
  if (outcome === RECTIFICATION_OUTCOMES[0]) out["b1"] = B1_OPTIONS[0];
  else if (outcome === RECTIFICATION_OUTCOMES[1]) {
    out["b1"] = B1_OPTIONS[1];
    const work = list(short["rectificationWork"]);
    if (work.length) out["b2"] = work;
    else flagged.push("Electrical fixes: the required work isn't ticked.");
    if (work.includes(B2_OPTIONS[5])) {
      if (txt(short["rectificationOther"])) out["b2.other"] = txt(short["rectificationOther"]);
      else flagged.push("Electrical fixes: 'Other' is ticked but not described.");
    }
  } else if (outcome === RECTIFICATION_OUTCOMES[2]) out["b1"] = B1_OPTIONS[2];
  else flagged.push("Electrical fixes outcome: not answered.");

  // B3 declaration.
  if (ticked(short["b3.declaration"])) out["b3.declaration"] = true;
  else flagged.push("Electrician declaration: not ticked.");

  // Section C (only when rectification is required).
  if (outcome === RECTIFICATION_OUTCOMES[1]) {
    if (isYes(short["rectificationComplete"])) {
      for (let i = 1; i <= 7; i++) out[`c.tick${i}`] = true;
      out["c.completionDate"] = ctx.today;
    } else flagged.push("Section C: electrical fixes completion not confirmed — Section C stays incomplete.");
    if (txt(short["coesNumber"])) out["c.coes"] = txt(short["coesNumber"]);
    else flagged.push("Section C: Certificate of Electrical Safety number missing.");
    if (txt(short["certDate"])) out["c.certDate"] = txt(short["certDate"]);
    else flagged.push("Section C: certification date missing.");
  }

  // Owner declaration.
  if (isYes(short["ownerConfirm"])) for (let i = 1; i <= 4; i++) out[`o.tick${i}`] = true;
  else flagged.push("Owner declaration: not confirmed.");

  // Signatures live in the signed snapshot, not as form text.
  if (!txt(short["electricianSignature"])) flagged.push("Electrician signature missing.");
  if (!txt(short["ownerSignature"])) flagged.push("Owner signature missing.");
  return { answers: out, flagged };
}

export function expandPiisa(short: ShortAnswers, ctx: ExpandContext): ExpandResult {
  const out: OfficialAnswers = {};
  const flagged: string[] = [];
  const piesa = ctx.piesaAnswers ?? null;
  copy(out, short, ["jobRef", "address", "startDate", "completionDate", "p2.installDate", "p2.ap", "p2.company", "p2.lead", "p2.leadEec", "p7.products", "p8.name", "p8.date"]);

  if (isYes(short["powerInformed"]) || isNo(short["powerInformed"])) out["p1.powerInformed"] = isYes(short["powerInformed"]) ? "Yes" : "No";
  else flagged.push("Power-off notice to the household: not answered.");

  // Life support: enquiry record confirmed onsite; the consent/plan carries over from the signed PIESA.
  if (isYes(short["lifeSupportConfirm"])) {
    if (ctx.lifeSupportDeclared === "yes" || ctx.lifeSupportDeclared === "no") {
      out["lifeSupport"] = ctx.lifeSupportDeclared === "yes" ? "Yes" : "No";
      if (ctx.lifeSupportDeclared === "yes") {
        const consent = txt(short["lifeSupportConsent"]) || (piesa ? txt(piesa["lifeSupportConsent"]) : "");
        const att = txt(short["lifeSupportAttachment"]) || ctx.piesaLifeSupportAttachment || "";
        if (consent) out["lifeSupportConsent"] = consent; else flagged.push("Life support: consent or medical plan answer missing.");
        if (att) out["lifeSupportAttachment"] = att; else flagged.push("Life support: consent or medical plan attachment missing.");
      }
    } else flagged.push("Life support: the enquiry has no clear answer — the office must confirm it.");
  } else if (isNo(short["lifeSupportConfirm"])) {
    flagged.push("Life support: the installer says the office record is wrong — STOP, the office must resolve it before installation.");
  } else flagged.push("Life support: not confirmed onsite.");

  // Crew: additional installers into the official 3-row table.
  for (let n = 1; n <= 3; n++) {
    if (txt(short[`crewName${n}`])) out[`p2.addName#${n - 1}`] = txt(short[`crewName${n}`]);
    if (txt(short[`crewEec${n}`])) out[`p2.addEec#${n - 1}`] = txt(short[`crewEec${n}`]);
    if (txt(short[`crewName${n}`]) && !txt(short[`crewEec${n}`])) flagged.push(`Additional installer ${n}: EEC certification number missing.`);
  }

  // Part 3 safe system of work: one clear answer sets all three official questions.
  if (isYes(short["swmsComplete"]) || isNo(short["swmsComplete"])) {
    const v = isYes(short["swmsComplete"]) ? "Yes" : "No";
    out["p3.swms"] = v; out["p3.table1"] = v; out["p3.isolated"] = v;
  } else flagged.push("Safe system of work: not answered.");

  // Part 4 solar: carried over from the signed PIESA (never re-asked).
  if (piesa) {
    for (const [piisaId, piesaId] of [["p4.present", "p3.present"], ["p4.instructions", "p3.instructions"], ["p4.isolator", "p3.isolator"]] as const) {
      if (txt(piesa[piesaId])) out[piisaId] = txt(piesa[piesaId]);
    }
  } else flagged.push("Solar/battery: no signed PIESA to carry the answers over from.");

  // Part 5 PIESA review.
  if (isYes(short["piesaReviewed"]) || isNo(short["piesaReviewed"])) {
    const v = isYes(short["piesaReviewed"]) ? "Yes" : "No";
    out["p5.reviewed"] = v; out["p5.noAccess"] = v;
  } else flagged.push("PIESA review: not answered.");
  const b1 = piesa ? txt(piesa["b1"]) : "";
  const electricianRequired = b1 === B1_OPTIONS[2];
  if (b1 === B1_OPTIONS[0]) out["p5.electricianPresent"] = "N/A";
  else if (electricianRequired) {
    if (isYes(short["electricianHere"])) out["p5.electricianPresent"] = "Yes";
    else if (isNo(short["electricianHere"])) out["p5.electricianPresent"] = "No";
    else flagged.push("Electrician presence at start: not answered.");
  } else if (b1) out["p5.electricianPresent"] = "N/A";
  else flagged.push("Electrician presence: no signed PIESA outcome to refer to.");
  // Downlights and Section C confirmations come from the signed PIESA.
  if (piesa) {
    if (txt(piesa["p6.recessed"])) out["p5.recessed"] = txt(piesa["p6.recessed"]);
    if (txt(piesa["p6.count"])) out["p5.count"] = txt(piesa["p6.count"]);
    const cTick = (id: string) => (ticked(piesa[id]) ? "Yes" : txt(piesa[id]) ? "No" : null);
    for (const [piisaId, piesaId] of [["p5.icConfirmed", "c.tick2"], ["p5.safeToCover", "c.tick2"], ["p5.rcd", "c.tick3"], ["p5.tps", "c.tick4"], ["p5.basic", "c.tick5"]] as const) {
      const v = cTick(piesaId);
      if (v) out[piisaId] = v;
      else if (b1 === B1_OPTIONS[0]) out[piisaId] = "Yes"; // no rectification required: the signed PIESA confirmed these in Part 2–6
      else flagged.push(`${piisaId}: the signed PIESA Section C has no answer.`);
    }
  } else flagged.push("Downlight and cable confirmations: no signed PIESA to carry over from.");

  // Part 6 existing insulation (measure-up answer shown as a reminder; the installer still answers).
  if (isYes(short["existingInsulation"]) || isNo(short["existingInsulation"])) {
    out["p6.present"] = isYes(short["existingInsulation"]) ? "Yes" : "No";
    if (isYes(short["existingInsulation"])) {
      const t = txt(short["insulationTreatment"]);
      if (t === "Removed" || t === "Topped Up") out["p6.treatment"] = [t];
      else flagged.push("Existing insulation: remove/top-up not answered.");
      if (txt(short["insulationHeight"])) out["p6.height"] = txt(short["insulationHeight"]);
      else flagged.push("Existing insulation: average height missing.");
      if (txt(short["insulationRValue"])) out["p6.rValue"] = txt(short["insulationRValue"]);
      if (t === "Topped Up") {
        out["p6.suitable"] = "Yes"; // topping up is only offered when suitable; the SWMS/PIESA gates still apply
        if (txt(short["insulationReason"])) out["p6.reason"] = txt(short["insulationReason"]);
        else flagged.push("Existing insulation: reason for not removing it is missing.");
      } else if (t === "Removed") out["p6.suitable"] = "No";
    }
  } else flagged.push("Existing insulation: not answered.");

  if (ticked(short["p8.declaration"])) out["p8.declaration"] = true;
  else flagged.push("Installer declaration: not ticked.");
  if (!txt(short["installerSignature"])) flagged.push("Installer signature missing.");
  return { answers: out, flagged };
}

export const expandShortAnswers = (key: OfficialKey, short: ShortAnswers, ctx: ExpandContext): ExpandResult =>
  key === "piesa" ? expandPiesa(short, ctx) : expandPiisa(short, ctx);

/** Ids the expansion intentionally never fills (signed on paper / office-completed table detail). */
export const EXPANSION_EXCLUDED: Record<OfficialKey, string[]> = {
  piesa: ["c.signature", "o.signature", "p7.location", "p7.hazard", "p7.actions", "p7.otherHazard", "p7.otherAction"],
  piisa: ["p8.signature"],
};

/** Every official answer id is either filled by the expansion or explicitly excluded — nothing is silently dropped. */
export function expansionCoverage(key: OfficialKey): { covered: string[]; excluded: string[] } {
  const excluded = EXPANSION_EXCLUDED[key];
  const covered = answerItems(key).map((i) => i.id).filter((id) => !excluded.includes(id));
  return { covered, excluded };
}
