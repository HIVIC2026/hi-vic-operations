/** "Not in your area yet" owner email (Jo, decision 74; design docs/templates/owner/O7-not-in-area.html). Pure: no data
 *  access or delivery. Subject unchanged; the body follows the approved design through the shared email kit. */
import { PUBLIC_CALCULATOR_URL, type EstimateEmail } from "./estimate-email";
import * as K from "./email-kit.core";

export function renderCoverageUnavailableEmail(input: { firstName?: string | null; suburb?: string | null; postcode?: string | null; missing: Array<"REC / electrician" | "installer">; reference?: string | null }): EstimateEmail {
  const area = [input.suburb, input.postcode].filter(Boolean).join(" ") || "your area";
  const suburb = input.suburb?.trim() || "your area";
  const subject = `An update about Home Insulation Victoria service availability in ${area}`;
  const previewText = `Home Insulation Victoria service availability update for ${area}.`;
  const name = K.cleanName(input.firstName);
  const headline = `${name ? `${name}, we're` : "We're"} not in ${suburb} just yet`;
  // Decision 74: no checked installer AND electrician covering the area yet; the missing trade list stays truthful.
  const missing = input.missing.length === 2 || input.missing.length === 0 ? "a certified installer and licensed electrician" : input.missing[0] === "installer" ? "an approved installer" : "an approved licensed electrician";
  const intro = `Thanks for your enquiry. Your home looks like it could qualify for the VEU ceiling insulation rebate, but we don't have ${missing} with verified coverage for ${area} yet. We only send people we've checked, so we won't rush it.`;
  const next = [
    "<strong>We keep your details on file.</strong> You don't need to do anything.",
    "<strong>We're adding installers across Victoria.</strong> When one covers your area, we'll email you.",
    "<strong>No payment, no obligation.</strong>",
  ];
  const body = [
    K.h1(headline),
    K.p(intro),
    K.mistBox("What happens now", K.checkList(next), { padding: "16px 18px 6px", titleHtml: `What happens now` }).replace("margin-bottom:6px;", "margin-bottom:10px;"),
    K.friendCard(PUBLIC_CALCULATOR_URL, "eligibility"),
  ].join("\n");
  const html = K.emailShell({ body, previewText, unsubscribe: "slot" });
  const plainText = K.plainText([
    headline, "", intro, "",
    "WHAT HAPPENS NOW", ...next.map((n) => `✓ ${K.stripTags(n)}`), "",
    "Know someone thinking about insulation? They can check their own eligibility in about a minute.", `Send to a friend: ${PUBLIC_CALCULATOR_URL}`,
    ...(input.reference ? ["", `Reference: ${input.reference}`] : []),
  ]);
  return { subject, previewText, html, plainText };
}
