/** Pure Step 3 unopened three-day follow-up renderer. No data access or delivery.
 * MJML refresh (Jo 27 Oct 2026): docs/templates/mjml/owner_estimate-unopened.mjml, through `mjEmail` like the other emails. */
import { PRIVACY_URL, pixelTag, validEstimateUrl, validReferralUrl, validTrackingUrl, type EstimateEmail } from "./estimate-email";
import type { ActiveFollowupKind } from "./engagement.core";
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";

export type FollowupEmailInput = { kind: ActiveFollowupKind; estimateUrl: string; trackingClickUrl?: string | null; trackingPixelUrl?: string | null; referralUrl?: string | null };

const HELPER = "Your secure estimate link is personal to your property. No payment needed. No obligation to go ahead with installation.";
const DEMAND = "Thousands of Victorians have registered. Spots are released in the order they were saved."; // decision 388
const CONTACT_URL = "https://homeinsulationvictoria.com.au/contact";
const REASON = "You're getting this because you asked for a ceiling insulation estimate.";
const REFER = "Know someone else thinking about ceiling insulation? They can check their own eligibility.";

type Copy = { subject: string; preview: string; eyebrow: string; heading: string; intro: string; listTitle: string; ticks: string[]; listNote?: string; actionTitle: string; actionBody: string; demand?: boolean; cta: string; hash?: string };
const COPY: Record<ActiveFollowupKind, Copy> = {
  estimate_unopened_3d: {
    subject: "Just checking you received your Home Insulation Victoria estimate",
    preview: "Your estimate is saved and ready whenever you are. No payment, no obligation.",
    eyebrow: "Your preliminary estimate",
    heading: "Just checking you got your estimate",
    intro: "A few days ago we sent a preliminary ceiling insulation estimate for your home. It includes your estimated VEU rebate and what's included.",
    listTitle: "What your estimate shows",
    ticks: ["Your estimated VEU rebate", "Your estimated cost, including GST", "What the quote includes", "Your next step: save your spot (free, no obligation)"],
    actionTitle: "Take a look when it suits you",
    actionBody: "Your estimate is saved and ready. Open it any time to see the details.",
    cta: "View my estimate →",
  },
};

const LINK = "color:#3C51C4;font-weight:700;";

export function renderFollowupEmail(input: FollowupEmailInput): EstimateEmail {
  const c = COPY[input.kind];
  if (!c) throw new Error("Unknown follow-up kind.");
  const link = validEstimateUrl(input.estimateUrl);
  const base = link.toString().replace(/\/$/, "");
  const target = validTrackingUrl(input.trackingClickUrl, "click") ?? (c.hash ? `${base}${c.hash}` : link.toString());
  const pixel = validTrackingUrl(input.trackingPixelUrl, "pixel");
  const referral = validReferralUrl(input.referralUrl);
  const ticks = c.ticks.map((t, n) => { const pad = n === c.ticks.length - 1 ? 12 : 14; return `<tr><td width="34" valign="top" style="padding:2px 0 ${pad}px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 ${pad}px;">${K.esc(t)}</td></tr>`; }).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="eyebrow" padding="18px 12px 6px">${K.esc(c.eyebrow)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(c.heading)}</mj-text><mj-text>${K.esc(c.intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="h2" padding="18px 18px 10px">${K.esc(c.listTitle)}</mj-text><mj-table padding="0 18px 6px">${ticks}</mj-table>${c.listNote ? `<mj-text mj-class="small" padding="0 18px 14px">${K.esc(c.listNote)}</mj-text>` : ""}</mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">${K.esc(c.actionTitle)}</mj-text><mj-text>${K.esc(c.actionBody)}</mj-text>${c.demand ? `<mj-text font-weight="700" color="#057D40">${K.esc(DEMAND)}</mj-text>` : ""}<mj-button href="${K.esc(target)}">${K.esc(c.cta).replace(/ →$/, " &rarr;")}</mj-button><mj-text mj-class="small" padding="0 12px 0">${K.esc(HELPER)}</mj-text></mj-column></mj-section>`,
    referral ? `<mj-section><mj-column><mj-text mj-class="center" font-size="14px" line-height="22px" padding="14px 12px 0">${K.esc(REFER)} <a href="${K.esc(referral)}" style="${LINK}">Refer a friend &rarr;</a></mj-text></mj-column></mj-section>` : "",
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${K.esc(REASON)} <a href="${CONTACT_URL}" style="${LINK}">Contact us</a> · <a href="${K.esc(PRIVACY_URL)}" style="${LINK}">Privacy</a></mj-text></mj-column></mj-section>`,
  ].join("\n");
  const compiled = mjEmail({ subject: c.subject, preview: c.preview, body, unsubscribe: "slot" });
  const html = pixel ? compiled.replace("</body>", `${pixelTag(pixel)}</body>`) : compiled;
  const plainText = K.plainText([
    c.eyebrow.toUpperCase(), c.heading, "", c.intro, "",
    c.listTitle.toUpperCase(), ...c.ticks.map((t) => `✓ ${t}`), ...(c.listNote ? [c.listNote] : []), "",
    c.actionTitle.toUpperCase(), c.actionBody, ...(c.demand ? [DEMAND] : []),
    `${c.cta.replace(/ →$/, "")}: ${target}`, HELPER,
    ...(referral ? ["", REFER, `Refer a friend: ${referral}`] : []), "",
    REASON, `Contact us: ${CONTACT_URL} · Privacy: ${PRIVACY_URL}`,
  ]);
  return { subject: c.subject, previewText: c.preview, html, plainText };
}
