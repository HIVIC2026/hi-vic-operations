// Copy, formatting and attachment types only. Legacy HTML presentation builders retired by E0.
// All email presentation is owned by mail-mjml.core.ts and mjml-lite.core.ts.
export const AP_NUMBER = "A003654";
export const ENTITY_LINE = "DC Construction Solutions Pty Ltd";
export const ABN_LINE = "ABN 44 671 613 979";
export const FOOTER_TEXT = `Home Insulation Victoria · VEU Accredited Person ${AP_NUMBER} · ${ENTITY_LINE} · ${ABN_LINE}`;

/** A file sent with an email (Resend `attachments`): base64 content, a filename the owner will see, and its media type. */
export type EmailAttachment = { filename: string; content: string; contentType: string };

/** Escapes text for HTML. Apostrophes stay literal, as in the approved files. */
export const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "$1,610" (whole dollars) and "$2,200.00" (cents) in en-AU. */
export const whole = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
export const cents = (n: number) => `$${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const m2 = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} m²`;
/** Trimmed first name, or null. */
export const cleanName = (s: string | null | undefined) => s?.trim().replace(/\s+/g, " ").split(" ")[0] || null;

export type TickItem = { title: string; detail?: string | null } | string;
export type Step = { title: string; detail?: string | null };
export type QuoteRow = { title: string; detail?: string | null; amount: string; bold?: boolean; color?: string };
export const THIRTY_DAY_CLOCK_TEXT = (expiresOn?: string | null) => expiresOn
  ? `The 30-day clock: please approve this quickly. Your safety check expires 30 days after it was done (on ${expiresOn}), and the fixes and the install both need to happen before then. If it expires, a new safety check is needed and may be charged.`
  : "The 30-day clock: your install must happen within 30 days of this safety check. After 30 days the check expires and has to be done again, and a new check may be charged. So once it's done, please book your install day as soon as the installer offers times, and approve any electrical fixes quickly.";

export const HOMEOWNER_PAGE_URL = "https://homeinsulationvictoria.com.au/homeowner";
export const FRIEND_SHARE_SUBJECT = "Free ceiling insulation check";
export const friendShareBody = (link: string) => `Hi, I thought this might help. Home Insulation Victoria can help you get the Victorian ceiling insulation rebate. Have a look here: ${link}`;
export const friendShareHref = (link: string) => `mailto:?subject=${encodeURIComponent(FRIEND_SHARE_SUBJECT)}&body=${encodeURIComponent(friendShareBody(link))}`;

export function includedItems(rebate: number): TickItem[] {
  return [
    { title: "Licensed electrician safety check", detail: "Required before any insulation goes in. They check wiring, downlights and cables so your ceiling is safe." },
    { title: "Premium R5.0 ceiling batts", detail: "Approved for the VEU program and made to Australian Standard AS/NZS 4859.1." },
    { title: "Fitted by an EEC-certified installer", detail: "Certified Insulation Installer (CII) through the Energy Efficiency Council, installing to Australian Standard AS 3999." },
    { title: "We handle the rebate", detail: `As a VEU Accredited Person (${AP_NUMBER}), we do all the government paperwork. The ${whole(rebate)} comes straight off your price.` },
  ];
}
/** "Not included, only if needed" rows; `someInsulation` swaps the removal line (O2). */
export function notIncludedItems(someInsulation = false): string[] {
  return [
    someInsulation ? "<strong>Removing old insulation</strong>, only if it can't stay ($15 per m², see above)" : "<strong>Removing old insulation</strong>, if any needs to come out",
    "<strong>Ceiling access fee</strong>, if your ceiling is hard to get into",
    "<strong>Electrical fixes</strong>, if the safety check finds any",
    "<strong>A bigger ceiling</strong> than you told us",
  ];
}
/** Decision 388: the line under the two cards (no Ready Check, no measuring, no quote timing). */
export const INCLUDED_CLOSING = "You'll know the exact price before you agree to anything.";
/** Plain-text twin of the two cards. */
export function includedAndNotIncludedText(i: { price: number; rebate: number; someInsulation?: boolean; closing?: string }): string[] {
  const inc = includedItems(i.rebate).map((t) => typeof t === "string" ? `✓ ${t}` : `✓ ${t.title}: ${t.detail ?? ""}`.trim());
  const not = notIncludedItems(i.someInsulation).map((h) => `+ ${stripTags(h)}`);
  return [`WHAT'S INCLUDED IN ${whole(i.price)}`, ...inc, "", "NOT INCLUDED, ONLY IF NEEDED", ...not, "", i.closing ?? INCLUDED_CLOSING];
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------
export const stripTags = (html: string) => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
/** Joins lines (dropping null/false), then the AP/ABN footer and the unsubscribe/TEST lines. */
export function plainText(lines: Array<string | null | false | undefined>, opts: { unsubscribe?: string | null; testLabel?: boolean } = {}): string {
  const body = lines.filter((l): l is string => typeof l === "string");
  return [...body, "", FOOTER_TEXT, ...(opts.unsubscribe ? [`Unsubscribe: ${opts.unsubscribe}`] : []), ...(opts.testLabel ? ["", "TEST — only sent to Jo."] : [])].join("\n");
}
