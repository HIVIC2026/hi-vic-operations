// LR-003 change requests (Jo, 2026-10-02): pre-fills, defaults, reminders and cross-checks for the official
// PIESA / PIISA. PURE: no I/O. Rules:
// - "prefill" seeds an editable answer from a portal record; the signer can always change it.
// - "reminder" / "cross_check" only SHOW a related record beside the question — they never become the answer.
// - An empty or unknown source leaves the answer blank (never "No"); the signer must answer.
// - Declared values (owner enquiry) stay DECLARED and must be confirmed onsite by the signer.
import { B1_OPTIONS, type OfficialAnswers, type OfficialKey } from "./official-forms.core";

export type PrefillBasis = "portal_record" | "declared" | "verified" | "default_today" | "signed_piesa" | "accepted_quote" | "measure_up";
export type PrefillMode = "prefill" | "reminder" | "cross_check";
export type PrefillHint = {
  itemId: string; mode: PrefillMode;
  /** Value to seed (prefill) or to show (reminder/cross_check). null = no source; the signer answers. */
  value: string | null; basis: PrefillBasis; from: string;
  /** Always true: nothing here locks an answer. */ editable: true;
  /** Plain-language note shown beside the question. */ note: string;
};

export type LifeSupportDeclared = "yes" | "no" | "unknown" | null;
export type OfficialPrefillContext = {
  today: string;
  jobNumber: string | null; address: string | null;
  lifeSupportDeclared: LifeSupportDeclared;
  /** Booked installation date (YYYY-MM-DD, Melbourne). */ installDate: string | null;
  /** Fixed AP identity used on customer documents. */ apName: string | null;
  installerBusinessName: string | null;
  /** Signed-in lead installer. EEC number is used only when the certification is verified and current. */
  leadInstaller: { name: string | null; eecNumber: string | null; eecVerified: boolean } | null;
  /** Answers of the CURRENT signed PIESA on the same job (null if none). */ piesaAnswers: OfficialAnswers | null;
  /** File id of the life-support consent/plan attached to the signed PIESA. */ piesaLifeSupportAttachment: string | null;
  /** Current accepted measure-up: was existing insulation recorded? */ measuredInsulationPresent: boolean | null;
  /** Product brand/model/R-value from the accepted quote. */ acceptedQuoteProduct: string | null;
};

const txt = (v: unknown) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)).trim();
const blankTo = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ticked = (v: unknown) => v === true || /^(yes|true|ticked|checked)$/i.test(txt(v));
const hint = (itemId: string, mode: PrefillMode, value: string | null, basis: PrefillBasis, from: string, note: string): PrefillHint => ({ itemId, mode, value, basis, from, editable: true, note });

const NO_SOURCE = "No record to pre-fill from — please answer.";
function lifeSupport(ctx: OfficialPrefillContext, who: "electrician" | "installer"): PrefillHint {
  const v = ctx.lifeSupportDeclared === "yes" ? "Yes" : ctx.lifeSupportDeclared === "no" ? "No" : null;
  return hint("lifeSupport", "prefill", v, "declared", "Owner enquiry (declared)",
    v ? `Owner declared "${v}" in the enquiry. This is DECLARED, not verified — the ${who} must confirm it onsite.` : `Owner didn't give a clear answer in the enquiry — the ${who} must ask onsite.`);
}
const today = (id: string, ctx: OfficialPrefillContext, who: string) =>
  hint(id, "prefill", isDate(ctx.today) ? ctx.today : null, "default_today", "Today's date", `Defaults to today — the ${who} can change it.`);
const installDate = (id: string, ctx: OfficialPrefillContext) =>
  hint(id, "prefill", isDate(ctx.installDate) ? ctx.installDate : null, "portal_record", "Booked installation",
    isDate(ctx.installDate) ? "From the booked installation date — the installer can change it." : NO_SOURCE);
const jobRef = (ctx: OfficialPrefillContext) => hint("jobRef", "prefill", blankTo(ctx.jobNumber), "portal_record", "Job number", blankTo(ctx.jobNumber) ? "From the job number." : NO_SOURCE);
const address = (ctx: OfficialPrefillContext) => hint("address", "prefill", blankTo(ctx.address), "portal_record", "Property address", blankTo(ctx.address) ? "From the property address — check the postcode." : NO_SOURCE);

export function piesaPrefill(ctx: OfficialPrefillContext): PrefillHint[] {
  return [jobRef(ctx), address(ctx), today("inspectionDate", ctx, "electrician"), lifeSupport(ctx, "electrician")];
}

/** PIESA answer shown beside a PIISA question. Reads only the signed PIESA; never answers the PIISA. */
function fromPiesa(itemId: string, mode: "reminder" | "cross_check", ctx: OfficialPrefillContext, piesaId: string, label: string, asTick = false): PrefillHint {
  const a = ctx.piesaAnswers;
  const raw = a ? a[piesaId] : undefined;
  const value = !a ? null : asTick ? (ticked(raw) ? "Ticked" : txt(raw) ? "Not ticked" : null) : blankTo(txt(raw));
  return hint(itemId, mode, value, "signed_piesa", `Signed PIESA — ${label}`,
    !a ? "No signed PIESA on this job yet — nothing to compare." : value == null ? `The signed PIESA has no answer for ${label}.` : `Signed PIESA ${label}: "${value}". Shown as a reminder — the installer still answers.`);
}

export function piisaPrefill(ctx: OfficialPrefillContext): PrefillHint[] {
  const lead = ctx.leadInstaller;
  const eec = lead?.eecVerified ? blankTo(lead.eecNumber) : null;
  const b1 = ctx.piesaAnswers ? txt(ctx.piesaAnswers["b1"]) : "";
  const noRect = b1 === B1_OPTIONS[0];
  const ls = lifeSupport(ctx, "installer");
  return [
    jobRef(ctx), address(ctx), installDate("startDate", ctx), ls,
    hint("lifeSupportAttachment", "prefill", blankTo(ctx.piesaLifeSupportAttachment), "signed_piesa", "Signed PIESA attachment",
      blankTo(ctx.piesaLifeSupportAttachment) ? "Attached from the signed PIESA on this job — the installer must still check it." : "No consent or medical plan is attached to the signed PIESA — the installer must attach one if life support applies."),
    installDate("p2.installDate", ctx),
    hint("p2.ap", "prefill", blankTo(ctx.apName), "portal_record", "Accredited Person", blankTo(ctx.apName) ? "Home Insulation Victoria's Accredited Person name." : NO_SOURCE),
    hint("p2.company", "prefill", blankTo(ctx.installerBusinessName), "portal_record", "Assigned installer business", blankTo(ctx.installerBusinessName) ? "From the installer assigned to this job." : NO_SOURCE),
    hint("p2.lead", "prefill", blankTo(lead?.name), "portal_record", "Signed-in installer profile", blankTo(lead?.name) ? "From the signed-in installer's profile." : NO_SOURCE),
    hint("p2.leadEec", "prefill", eec, "verified", "Verified EEC certification",
      eec ? "From the verified, current EEC certification on file." : "No verified, current EEC certification on file — the installer must enter it and the office will check it."),
    fromPiesa("p4.present", "cross_check", ctx, "p3.present", "Part 3 solar/battery"),
    hint("p5.electricianPresent", "prefill", noRect ? "N/A" : null, "signed_piesa", "Signed PIESA outcome (B1)",
      noRect ? "Set to N/A because the signed PIESA says no rectification is required — the installer can change it." : ctx.piesaAnswers ? "The signed PIESA doesn't say no rectification is required — the installer must answer." : "No signed PIESA on this job yet — the installer must answer."),
    fromPiesa("p5.recessed", "cross_check", ctx, "p6.recessed", "Part 6 recessed luminaires"),
    fromPiesa("p5.icConfirmed", "reminder", ctx, "c.tick2", "Section C (IC / IC-4 luminaires)", true),
    fromPiesa("p5.safeToCover", "reminder", ctx, "c.tick2", "Section C (IC / IC-4 luminaires)", true),
    fromPiesa("p5.rcd", "reminder", ctx, "c.tick3", "Section C (RCD protection)", true),
    fromPiesa("p5.tps", "reminder", ctx, "c.tick4", "Section C (TPS cables)", true),
    fromPiesa("p5.basic", "reminder", ctx, "c.tick5", "Section C (Basic Protection)", true),
    hint("p6.present", "reminder", ctx.measuredInsulationPresent == null ? null : ctx.measuredInsulationPresent ? "Yes" : "No", "measure_up", "Accepted measure-up",
      ctx.measuredInsulationPresent == null ? "The measure-up has no insulation answer — nothing to compare." : `Measure-up recorded existing insulation: "${ctx.measuredInsulationPresent ? "Yes" : "No"}". Shown as a reminder — the installer still answers.`),
    hint("p7.products", "prefill", blankTo(ctx.acceptedQuoteProduct), "accepted_quote", "Accepted quote",
      blankTo(ctx.acceptedQuoteProduct) ? "From the accepted quote — the installer must confirm the product used on the day." : NO_SOURCE),
    hint("p8.name", "prefill", blankTo(lead?.name), "portal_record", "Signed-in installer profile", blankTo(lead?.name) ? "From the signed-in installer's profile." : NO_SOURCE),
    today("p8.date", ctx, "installer"),
  ];
}

export const officialPrefill = (key: OfficialKey, ctx: OfficialPrefillContext) => (key === "piesa" ? piesaPrefill(ctx) : piisaPrefill(ctx));

/** Starting answers: only "prefill" hints with a value. Reminders and cross-checks are never copied into answers. */
export function seedAnswers(hints: PrefillHint[]): OfficialAnswers {
  const out: OfficialAnswers = {};
  for (const h of hints) if (h.mode === "prefill" && h.value != null) out[h.itemId] = h.value;
  return out;
}

/** Non-blocking warnings where the signer's answer differs from the related PIESA / measure-up record. */
export function crossCheckWarnings(hints: PrefillHint[], answers: OfficialAnswers): string[] {
  const out: string[] = [];
  for (const h of hints) {
    if (h.mode !== "cross_check" && h.itemId !== "p6.present") continue;
    const ans = txt(answers[h.itemId]);
    if (!h.value || !ans) continue;
    if (ans.toLowerCase() !== h.value.toLowerCase()) out.push(`${h.itemId}: answered "${ans}" but ${h.from} says "${h.value}". Check before signing.`);
  }
  return out;
}

/** Maps the enquiry's stored life-support status to the declared value used above. */
export function declaredLifeSupport(status: string | null | undefined): LifeSupportDeclared {
  const s = txt(status).toLowerCase();
  return s === "yes" ? "yes" : s === "no" ? "no" : s ? "unknown" : null;
}
