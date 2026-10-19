/**
 * Generate faithful local previews of Jo's T1–T8 emails for browser UAT.
 * Renders through the EXACT production renderers, then inlines the Spot Saved header
 * art (drawn by email-hero.core) and the brand logo as data URIs so the screenshots
 * show the real artwork without a live server. No email is sent. No DB is touched.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import {
  renderJoOutcomeEmail,
  renderJoReadyCheckInvitationEmail,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { emailArtUrl } from "../src/lib/email-art.core";
import { renderHeaderArt, campaignHeroSpec } from "../src/lib/email-hero.core";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
import { CUSTOMER_BRAND } from "../src/lib/customer-quote-system";

const OUT = "/tmp/jo_emails";
mkdirSync(OUT, { recursive: true });

const RECIPIENT = {
  firstName: "Alex",
  propertyAddress: "12 Sample St, Melbourne VIC 3000",
  enquiryReference: "HV-0000",
};
const LINKS = {
  saveMySpotUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/campaign",
  uploadMediaUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/video",
  reviewResultUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
  calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok#calculator",
};
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
const figures = (area: number, estimated: boolean) => ({
  veuRebate: 2600,
  customerTotal: 1900,
  totalBeforeRebate: 4500,
  installation: 3800,
  piesaFee: 350,
  apFee: 350,
  ceilingAreaM2: area,
  areaEstimated: estimated,
});

const b64 = (u8: Uint8Array) => Buffer.from(u8).toString("base64");

// Pre-render the two header art kinds we need (Jo T1–T6 = headline, T8 = spot).
const ART: Record<string, string> = {
  headline: `data:image/png;base64,${b64(renderHeaderArt(campaignHeroSpec("likely", "Alex", "$2,600")))}`,
  spot: `data:image/png;base64,${b64(renderHeaderArt(campaignHeroSpec("spot", "Alex", "$2,600")))}`,
};

// Inline the brand logo (remote URL -> data URI) so it renders offline.
let LOGO = CUSTOMER_BRAND.logoUrl;
try {
  const res = await fetch(CUSTOMER_BRAND.logoUrl);
  const buf = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "image/png";
  LOGO = `data:${ct};base64,${b64(buf)}`;
  console.log("logo inlined:", buf.length, "bytes");
} catch (e) {
  console.warn("logo fetch failed, leaving remote url:", (e as Error).message);
}

function inline(html: string): string {
  // Replace every server-generated email-art URL with the locally drawn PNG.
  html = html.replace(/https?:\/\/[^"'\s]*\/api\/public\/email-art\/[^"'\s]+\/(?:headline|spot|pay|next|cap-estimate|cap-gets)\.png/g,
    (url) => {
      const kind = /(headline|spot|pay|next|cap-estimate|cap-gets)\.png$/.exec(url)?.[1];
      if (kind === "headline") return ART.headline;
      if (kind === "spot") return ART.spot;
      return url;
    });
  // Inline the logo.
  html = html.split(CUSTOMER_BRAND.logoUrl).join(LOGO);
  return html;
}

type Spec = { id: string; render: () => string };

const specs: Spec[] = [
  { id: "T1", render: () => withUnsubscribe(renderJoOutcomeEmail({
    outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false,
    recipient: RECIPIENT, links: LINKS, figures: figures(150, true),
  })!, UNSUB).html },
  { id: "T2", render: () => withUnsubscribe(renderJoOutcomeEmail({
    outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true,
    recipient: RECIPIENT, links: LINKS, figures: figures(210, false),
  })!, UNSUB).html },
  { id: "T3", render: () => withUnsubscribe(renderJoOutcomeEmail({
    outcome: "likely_eligible", insulation: "present", deskCheckStatus: "looks_eligible",
    ceilingSizeKnown: false, recipient: RECIPIENT, links: LINKS, figures: figures(150, true),
  })!, UNSUB).html },
  { id: "T4", render: () => withUnsubscribe(renderJoOutcomeEmail({
    outcome: "likely_eligible", insulation: "present", deskCheckStatus: "looks_eligible",
    ceilingSizeKnown: true, recipient: RECIPIENT, links: LINKS, figures: figures(210, false),
  })!, UNSUB).html },
  { id: "T5", render: () => withUnsubscribe(renderJoOutcomeEmail({
    outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false,
    recipient: RECIPIENT, links: LINKS, figures: figures(150, true),
  })!, UNSUB).html },
  { id: "T6", render: () => withUnsubscribe(renderJoOutcomeEmail({
    outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true,
    recipient: RECIPIENT, links: LINKS, figures: figures(210, false),
  })!, UNSUB).html },
  { id: "T7", render: () => withUnsubscribe(renderJoOutcomeEmail({
    outcome: "does_not_appear_eligible", insulation: null, reason: "Built after 2010.",
    ceilingSizeKnown: false, recipient: RECIPIENT, links: LINKS,
  })!, UNSUB).html },
  { id: "T8", render: () => withUnsubscribe(renderJoReadyCheckInvitationEmail(RECIPIENT, {
    ...figures(150, true),
    savedAt: "2026-10-19T00:00:00Z",
    personalEstimateUrl: "https://estimate.homeinsulationvictoria.com.au/my-estimate/tok",
    readyCheckBookingUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
  }), UNSUB).html },
];

for (const s of specs) {
  const raw = s.render();
  const html = inline(raw);
  writeFileSync(`${OUT}/${s.id}.html`, html);
  const hasArt = html.includes("data:image/png;base64,") && !html.includes("/api/public/email-art/");
  const hasLogo = html.includes("data:image") && !html.includes("homeinsulationvictoria.com.au/home-insulation-victoria-logo.png");
  console.log(`${s.id}: ${html.length} bytes | art inlined=${hasArt} | logo inlined=${hasLogo}`);
}
console.log("WROTE", specs.length, "files to", OUT);
