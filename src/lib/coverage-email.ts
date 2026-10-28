/** "Not in your area yet" owner email (Jo, decision 74; MJML refresh 27 Oct 2026: docs/templates/mjml/owner_O7.mjml).
 *  Pure: no data access or delivery. */
import { type EstimateEmail } from "./estimate-email";
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";

export function renderCoverageUnavailableEmail(input: { firstName?: string | null; suburb?: string | null; postcode?: string | null; missing: Array<"REC / electrician" | "installer">; reference?: string | null }): EstimateEmail {
  const area = [input.suburb, input.postcode].filter(Boolean).join(" ") || "your area";
  const suburb = input.suburb?.trim() || "your area";
  const name = K.cleanName(input.firstName);
  const subject = `${name ? `${name}, we're` : "We're"} not in ${area} just yet`;
  const previewText = "We'll keep your details and email you when an installer covers your area.";
  const headline = `${name ? `${name}, we're` : "We're"} not in ${suburb} just yet`;
  // Decision 74: no checked installer AND electrician covering the area yet; the missing trade list stays truthful.
  const missing = input.missing.length === 2 || input.missing.length === 0 ? "a certified installer and licensed electrician" : input.missing[0] === "installer" ? "an approved installer" : "an approved licensed electrician";
  const intro = `Thanks for your enquiry. Your home looks like it could qualify for the VEU ceiling insulation rebate. But we don't yet have ${missing} with verified coverage for ${area}. We only send people we've checked, so we won't rush it.`;
  const next = [
    "We keep your details on file. You don't need to do anything.",
    "We're adding installers across Victoria. When one covers your area, we'll email you.",
    "No payment, no obligation.",
  ];
  const friend = { title: "Know someone thinking about insulation?", body: "They can check their own eligibility in about a minute." };
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${K.esc(headline)}</mj-text><mj-text>${K.esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What happens now</mj-text><mj-table padding="0 18px 6px">${next.map((t, n) => { const pad = n === next.length - 1 ? 12 : 14; return `<tr><td width="34" valign="top" style="padding:2px 0 ${pad}px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 ${pad}px;">${K.esc(t)}</td></tr>`; }).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 2px">${K.esc(friend.title)}</mj-text><mj-text padding="0 18px 6px">${K.esc(friend.body)}</mj-text><mj-text padding="0 18px 16px"><a href="${K.esc(K.friendShareHref(K.HOMEOWNER_PAGE_URL))}" style="color:#3C51C4;font-weight:700;">Send to a friend &rarr;</a></mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: previewText, body, unsubscribe: "slot" });
  const plainText = K.plainText([
    headline, "", intro, "",
    "WHAT HAPPENS NOW", ...next.map((n) => `✓ ${n}`), "",
    `${friend.title} ${friend.body}`, `Send to a friend: ${K.HOMEOWNER_PAGE_URL}`,
    ...(input.reference ? ["", `Reference: ${input.reference}`] : []),
  ]);
  return { subject, previewText, html, plainText };
}
