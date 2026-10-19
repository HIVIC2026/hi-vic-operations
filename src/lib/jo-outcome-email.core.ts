/**
 * P1-R3-S92 — GAP-1: the workflow-to-renderer wiring for Jo's templates 1–7.
 *
 * PURE module: no database, no network, no email sending, no pricing calculation. It exists so the
 * customer OUTCOME workflows stop hand-picking email copy and instead ask the single canonical
 * selector (`selectJoTemplate`) which of Jo's approved templates applies.
 *
 * Responsibilities, in order:
 *   1. Translate the job's Gate-1 outcome facts into `JoRoutingInput`.
 *   2. Let `selectJoTemplate()` choose the template (or null => no Jo email => fail closed).
 *   3. Render through the EXISTING renderers `renderJoEstimateEmail` / `renderJoIneligibleEmail`.
 *   4. Wrap Jo's verbatim copy into the existing approved HTML shell so the current delivery
 *      pipeline (subject / html / plainText) is unchanged in shape.
 *
 * This module never authors, edits or re-authorises Jo's wording. It only fills the placeholders
 * Jo left in her copy ([Save my spot →], [Upload my photos or video →], [Review my result →]).
 */
import {
  ctasForTemplate,
  renderJoEstimateEmail,
  renderJoIneligibleEmail,
  renderJoReadyCheckInvitation,
  selectJoTemplate,
  type JoCta,
  type JoEstimateFigures,
  type JoRecipient,
  type JoRoutingInput,
  type JoTemplateId,
  type SavedPricingSnapshot,
} from "./jo-email-templates.core";
import { applyReadyCheckFee, escape, type EstimateEmail } from "./estimate-email";

/** The post-Gate-1 official outcomes this wiring understands. */
export type JoOutcome =
  | "likely_eligible"
  | "needs_onsite_confirmation"
  | "does_not_appear_eligible";

/** Normalised declared insulation, matching the repo's `insulationDeclared` / `saved_insulation` values. */
export type JoInsulation = "none" | "present" | "unknown";

/** The Office desk-check verdict stored in lead_campaign_responses.desk_check_status. */
export type JoDeskCheck = "looks_eligible" | "not_eligible" | "needs_onsite_check";

/** Everything the selector needs, and nothing it must guess. */
export type JoOutcomeFacts = {
  outcome: JoOutcome | null;
  insulation: JoInsulation | null;
  /** true only for a declared/measured ceiling size; the typical-home default is NOT a known size. */
  ceilingSizeKnown: boolean;
  /** Null/absent = NOT reviewed, which is what keeps templates 3/4 shut. */
  deskCheckStatus?: JoDeskCheck | null;
};

export const JO_OUTCOME_TEMPLATE_LABEL: Record<Exclude<JoTemplateId, "ready_check_invitation">, string> = {
  eligible_no_insulation_size_unknown: "Eligible — no insulation, size unknown",
  eligible_no_insulation_size_known: "Eligible — no insulation, size known",
  eligible_below_r2_reviewed_size_unknown: "Below R2 reviewed — size unknown",
  eligible_below_r2_reviewed_size_known: "Below R2 reviewed — size known",
  potentially_eligible_unknown_size_unknown: "Potentially eligible — size unknown",
  potentially_eligible_unknown_size_known: "Potentially eligible — size known",
  ineligible: "Ineligible",
};

/**
 * Translate the job's facts into the routing input `selectJoTemplate` expects.
 *
 * Outcome vocabulary mapping (this repo -> Jo):
 *   likely_eligible            -> "likely_eligible"
 *   needs_onsite_confirmation  -> "needs_onsite_confirmation"
 *   does_not_appear_eligible   -> "ineligible"
 * Unknown insulation is never presented as "present"; a missing size is never presented as known.
 */
export function joRoutingInputFor(facts: JoOutcomeFacts): JoRoutingInput {
  const outcome =
    facts.outcome === "does_not_appear_eligible"
      ? "ineligible"
      : facts.outcome === "needs_onsite_confirmation"
        ? "needs_onsite_confirmation"
        : facts.outcome === "likely_eligible"
          ? "likely_eligible"
          : null;
  return {
    outcome,
    insulation: facts.insulation === "none" || facts.insulation === "present" ? facts.insulation : "unknown",
    ceilingSizeKnown: facts.ceilingSizeKnown === true,
    // Explicitly absent when not a real "looks_eligible" verdict: unreviewed is never treated as reviewed.
    ...(facts.deskCheckStatus === "looks_eligible" ? { deskCheckStatus: "looks_eligible" as const } : {}),
  };
}

/**
 * The canonical selection used by every wired outcome workflow. null = no Jo customer email applies.
 *
 * Template 8 is deliberately excluded here: a Ready Check invitation is an explicit Office action with
 * its own orchestration, never a side effect of an outcome email.
 */
export function selectJoOutcomeTemplate(facts: JoOutcomeFacts): Exclude<JoTemplateId, "ready_check_invitation"> | null {
  const id = selectJoTemplate(joRoutingInputFor(facts));
  if (!id || id === "ready_check_invitation") return null;
  return id;
}

// ---------------------------------------------------------------------------
// CTA / link binding into Jo's placeholders
// ---------------------------------------------------------------------------

/** The real URLs that fill Jo's placeholders. Each is the EXISTING authorised destination. */
export type JoOutcomeLinks = {
  /** T1–T4: the existing Save-my-spot campaign page for this customer. */
  saveMySpotUrl: string;
  /** T5/T6: the existing media-upload page for this customer (never Save-my-spot). */
  uploadMediaUrl: string;
  /** T7: the existing result page for this customer. */
  reviewResultUrl: string;
  /** The customer's own estimate page, used for "Open the calculator →". */
  calculatorUrl: string;
};

export type JoOutcomeEmailInput = JoOutcomeFacts & {
  recipient: JoRecipient;
  /** Templates 1–6 only; ignored for T7. */
  figures?: JoEstimateFigures;
  /** T7 only: the ineligibility reasons shown to the customer. */
  reason?: string | null;
  links: JoOutcomeLinks;
  /** Historical input only: Ready Check is free and Jo's copy stays untouched. */
  readyCheckFeeIncGst?: number | null;
  /** "current" = new-version cohort: adds the ex/inc GST supply rate wording. */
  pricingCohort?: "pre_cutover" | "legacy_saved_spot" | "current";
  installationRatePerM2?: number | null;
};

export type JoWiredEmail = EstimateEmail & {
  templateId: Exclude<JoTemplateId, "ready_check_invitation">;
  ctas: JoCta[];
};

/** Sentinel wrapping a substituted CTA so the block renderer can turn it into a button/link. */
const S = "\u0001";
const ctaToken = (kind: "cta" | "link", href: string, label: string) => `${S}${kind}|${href}|${label}${S}`;
/** A whole line that is exactly one token, and a token embedded inside a sentence. */
const TOKEN_LINE = new RegExp(`^\\u0001(cta|link)\\|([^|]+)\\|(.+)\\u0001$`);
const TOKEN_INLINE = new RegExp(`\\u0001(cta|link)\\|([^|]+)\\|(.+?)\\u0001`);

/** Jo's placeholder per CTA, in the exact wording of her copy. */
const PLACEHOLDER: Record<JoCta, string> = {
  save_my_spot: "[Save my spot →]",
  upload_media: "[Upload my photos or video →]",
  review_result: "[Review my result →]",
  book_ready_check: "[Book my Ready Check →]",
};
const CALCULATOR_LINE = "Want to explore a different ceiling size? Open the calculator →";

/**
 * Bind Jo's placeholders to the real, authorised URLs for this customer.
 * A CTA whose URL is missing is left unsubstituted so the renderer can throw rather than send a dead button.
 */
function bindLinks(body: string, links: JoOutcomeLinks, ctas: JoCta[]): string {
  let out = body;
  for (const cta of ctas) {
    const url =
      cta === "save_my_spot" ? links.saveMySpotUrl
        : cta === "upload_media" ? links.uploadMediaUrl
          : cta === "review_result" ? links.reviewResultUrl
            : null;
    if (!url) continue;
    const label = PLACEHOLDER[cta].slice(1, -1);
    out = out.split(PLACEHOLDER[cta]).join(ctaToken("cta", url, label));
  }
  // T1–T6 leave the calculator as plain sentence text; T8 already carries its own link.
  if (out.includes(CALCULATOR_LINE) && links.calculatorUrl) {
    out = out.split(CALCULATOR_LINE).join(
      `Want to explore a different ceiling size? ${ctaToken("link", links.calculatorUrl, "Open the calculator →")}`,
    );
  }
  return out;
}

function missingCta(ctas: JoCta[], body: string): JoCta | null {
  for (const cta of ctas) {
    if (body.includes(PLACEHOLDER[cta])) return cta;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Jo copy -> the existing approved email shell
// ---------------------------------------------------------------------------

const MIST = "#F3F6FF";
const LINE = "#E4E9F5";
const INK = "#22376B";
const F = "font-family:'Figtree',Arial,Helvetica,sans-serif;";
const FH = "font-family:'Outfit','Figtree',Arial,Helvetica,sans-serif;";

const inline = (s: string) =>
  escape(s)
    // Inline link/button tokens have already been emitted as raw HTML by the block renderer.
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/** Convert Jo's markdown subset (### headings, |tables|, **bold**, CTA tokens) to HTML blocks. */
function joBodyToHtml(body: string): string {
  const lines = body.split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      const card: string[] = [`<p style="margin:0 0 10px;${FH}color:${INK};font-size:19px;line-height:1.25;font-weight:800;">${escape(heading)}</p>`];
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) bodyLines.push(lines[i++]!);
      if (bodyLines.length) card.push(tableHtml(bodyLines));
      while (i < lines.length && lines[i]!.trim() && !lines[i]!.startsWith("### ") && !lines[i]!.startsWith("|")) {
        card.push(paragraphHtml(lines[i]!));
        i++;
      }
      blocks.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:16px;"><tr><td style="padding:17px 18px;${F}">${card.join("")}</td></tr></table>`);
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) rows.push(lines[i++]!);
      blocks.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:16px;"><tr><td style="padding:17px 18px;${F}">${tableHtml(rows)}</td></tr></table>`);
      continue;
    }
    blocks.push(paragraphHtml(line));
    i++;
  }
  return blocks.join("");
}

/** A CTA token line becomes the shared approved button; anything else is a paragraph. */
function paragraphHtml(line: string): string {
  const whole = TOKEN_LINE.exec(line);
  if (whole) {
    const [, kind, href, label] = whole;
    if (kind === "cta") return `<div style="padding:6px 0;">${buttonHtml(href!, label!)}</div>`;
    return `<p style="margin:0;${F}color:${INK};font-size:14px;line-height:1.55;text-align:center;"><a href="${escape(href!)}" style="color:#2F6BFF;font-weight:800;text-decoration:underline;">${escape(label!)}</a></p>`;
  }
  // A sentence that also carries an inline calculator link.
  const m = new RegExp(`^(.*?)${TOKEN_INLINE.source}`).exec(line);
  if (m) {
    return `<p style="margin:0;${F}color:${INK};font-size:14px;line-height:1.55;text-align:center;">${inline(m[1]!)} <a href="${escape(m[3]!)}" style="color:#2F6BFF;font-weight:800;text-decoration:underline;">${escape(m[4]!)}</a></p>`;
  }
  return `<p style="margin:0 0 8px;${F}color:${INK};font-size:15px;line-height:1.6;">${inline(line)}</p>`;
}

function buttonHtml(href: string, label: string): string {
  const GREEN = "#07BF61";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${GREEN}" style="background-color:${GREEN};border:0;border-radius:12px;mso-padding-alt:15px 18px;"><a href="${escape(href)}" style="display:block;padding:15px 18px;${F}color:#FFFFFF;font-size:16px;line-height:20px;font-weight:800;text-decoration:none;border-radius:12px;">${escape(label)}</a></td></tr></table>`;
}

function tableHtml(rows: string[]): string {
  const cells = (r: string) => r.split("|").slice(1, -1).map((c) => c.trim());
  if (!rows.length) return "";
  const header = cells(rows[0]!);
  // rows[1] is Jo's "|---|" separator.
  const body = rows.slice(2);
  const head = `<tr>${header.map((h, idx) => `<th align="${idx === 0 ? "left" : "right"}" style="padding:6px 0;${F}color:${INK};font-size:13px;font-weight:800;border-bottom:1px solid ${LINE};">${escape(h)}</th>`).join("")}</tr>`;
  const trs = body.map((r) => {
    const c = cells(r);
    return `<tr>${c.map((v, idx) => `<td align="${idx === 0 ? "left" : "right"}" style="padding:7px 0;${F}color:${INK};font-size:14px;line-height:1.45;${idx === 0 ? "" : "font-weight:700;white-space:nowrap;"}">${escape(v)}</td>`).join("")}</tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${head}${trs}</table>`;
}

/**
 * Render the Jo-approved email for this outcome.
 *
 * Returns null (fail closed) when no Jo template applies, so the caller can keep its existing
 * behaviour instead of sending an email Jo has not approved. Throws when a required CTA URL or
 * a complete pricing figure is missing — a half-built email is never delivered.
 */
export function renderJoOutcomeEmail(input: JoOutcomeEmailInput): JoWiredEmail | null {
  const id = selectJoOutcomeTemplate(input);
  if (!id) return null;

  if (id === "ineligible") {
    const rendered = renderJoIneligibleEmail(input.recipient, (input.reason ?? "").trim() || INELIGIBLE_FALLBACK_REASON);
    const body = bindLinks(rendered.body, input.links, rendered.ctas);
    const missing = missingCta(rendered.ctas, body);
    if (missing) throw new Error(`The ${missing} link is missing for this customer; nothing was prepared.`);
    return assemble(id, rendered.subject, body, rendered.ctas, input);
  }

  if (!input.figures) throw new Error("Templates 1–6 require the job's estimate figures; none were supplied.");
  const rendered = renderJoEstimateEmail(id, input.recipient, input.figures);
  const body = bindLinks(rendered.body, input.links, rendered.ctas);
  const missing = missingCta(rendered.ctas, body);
  if (missing) throw new Error(`The ${missing} link is missing for this customer; nothing was prepared.`);
  return assemble(id, rendered.subject, body, rendered.ctas, input);
}

export const INELIGIBLE_FALLBACK_REASON =
  "Based on the details provided, the property doesn’t meet the current requirements for a VEU ceiling insulation rebate.";

/**
 * P1-R3-S92 (GAP-2): wrap the EXISTING Template 8 renderer for delivery.
 *
 * The copy, the saved pricing and both CTAs all come from `renderJoReadyCheckInvitation()`. This function
 * only turns Jo's markdown links into the existing approved button/link markup — it never recalculates,
 * never substitutes the public calculator and never changes the personal-estimate or booking URLs.
 * The booking CTA keeps the customer on the EXISTING /estimate/{token} workflow, which never auto-books.
 */
export function renderJoReadyCheckInvitationEmail(recipient: JoRecipient, snapshot: SavedPricingSnapshot): JoT8Email {
  const rendered = renderJoReadyCheckInvitation(recipient, snapshot);
  let body = rendered.body;
  // Jo leaves the two CTAs as markdown links carrying the customer's own URLs.
  body = body.replace(
    /\[Book my Ready Check →\]\(([^)]+)\)/g,
    (_m, href: string) => ctaToken("cta", href, "Book my Ready Check →"),
  );
  body = body.replace(
    /\[Open the calculator →\]\(([^)]+)\)/g,
    (_m, href: string) => ctaToken("link", href, "Open the calculator →"),
  );
  if (missingCta(rendered.ctas, body)) throw new Error("The Ready Check booking link is missing for this customer; nothing was prepared.");
  return {
    templateId: "ready_check_invitation",
    ctas: rendered.ctas,
    subject: rendered.subject,
    previewText: rendered.subject,
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td class="lx-pad" style="padding:24px 30px;${F}">${joBodyToHtml(body)}</td></tr></table>`,
    plainText: plainTextOf(body),
  };
}

export type JoT8Email = EstimateEmail & { templateId: "ready_check_invitation"; ctas: JoCta[] };

function assemble(
  id: Exclude<JoTemplateId, "ready_check_invitation">,
  subject: string,
  body: string,
  ctas: JoCta[],
  input: JoOutcomeEmailInput,
): JoWiredEmail {
  const previewText = subject;
  const content = joBodyToHtml(body);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td class="lx-pad" style="padding:24px 30px;${F}">${content}</td></tr></table>`;
  // Jo's body is already the plain-text email; only the CTA markers need stripping.
  const plainText = plainTextOf(body);
  const mail: EstimateEmail = { subject, previewText, html, plainText };
  const withFee = applyReadyCheckFee(
    mail,
    {
      readyCheckFeeIncGst: input.readyCheckFeeIncGst ?? null,
      ...(input.pricingCohort ? { pricingCohort: input.pricingCohort } : {}),
      ...(input.installationRatePerM2 == null ? {} : { installationRatePerM2: input.installationRatePerM2 }),
    },
    false,
  );
  return { ...withFee, templateId: id, ctas };
}

/**
 * The plain-text twin of Jo's copy: token markers become readable "Label: url" lines, headings lose
 * their markdown prefix and Jo's markdown table becomes one "Item — $Amount" line per row.
 */
function plainTextOf(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const whole = TOKEN_LINE.exec(line);
    if (whole) { out.push(`${whole[3]!}: ${whole[2]!}`); continue; }
    if (/^\|\s*-+[-\s|]*\|$/.test(line)) continue; // Jo's |---| separator
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      out.push(cells.join(" — "));
      continue;
    }
    const heading = line.startsWith("### ") ? line.slice(4).trim() : line;
    out.push(
      heading
        .replace(new RegExp(TOKEN_INLINE.source, "g"), (_m, _kind, href, label) => `${label}: ${href}`)
        .replace(/\*\*(.+?)\*\*/g, "$1"),
    );
  }
  return out.join("\n");
}

export { ctasForTemplate };
