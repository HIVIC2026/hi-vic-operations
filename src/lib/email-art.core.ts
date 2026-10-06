// Light helpers for campaign email brand images (no fonts loaded here, safe for the browser preview bundle).
// The images themselves are drawn by email-hero.core.ts at /api/public/email-art/{token}/{kind}.png.
// v7 (Jo, 6 Oct): drawn phone-first — natural width is the 390px phone column, so nothing shrinks on a phone.
export type EmailArtKind = "headline" | "spot" | "pay" | "next" | "cap-estimate" | "cap-gets";
const OUTFIT_800_ADV: Record<string, number> = { "0": 0.671, "1": 0.39, "2": 0.576, "3": 0.569, "4": 0.613, "5": 0.568, "6": 0.579, "7": 0.53, "8": 0.569, "9": 0.579, "$": 0.613, ",": 0.287, ".": 0.304 };
export const AMOUNT_SIZE = 34, AMOUNT_LH = 38;
/** Header art natural width: a 390px phone minus the email's 18px side padding. Shown at this size on desktop too. */
export const HEADER_ART_W = 354;
/** Display width (1x px) of an amount drawn in Outfit 800 at 34px; used for both the PNG and the <img width>. */
export function amountArtWidth(text: string) { return Math.ceil([...text].reduce((w, c) => w + (OUTFIT_800_ADV[c] ?? 0.6) * AMOUNT_SIZE, 0)) + 4; }
export function emailArtUrl(origin: string, token: string, kind: EmailArtKind) { return `${origin}/api/public/email-art/${token}/${kind}.png`; }

/** Fixed card headings drawn as images. Sizes are 1x display px, measured from the bundled fonts (tests check them). */
export type HeadingArt = { kind: EmailArtKind; text: string; style: "h2" | "caps"; w: number; h: number; bg: string };
export const HEADING_ART: Record<string, HeadingArt> = {
  "Hold your place in line": { kind: "next", text: "Hold your place in line", style: "h2", w: 235, h: 28, bg: "#FDF2F6" },
  "Want to jump the queue?": { kind: "next", text: "Want to jump the queue?", style: "h2", w: 266, h: 28, bg: "#FDF2F6" },
  "Your estimate": { kind: "cap-estimate", text: "Your estimate", style: "caps", w: 106, h: 15, bg: "#F3F6FF" },
  "What you get": { kind: "cap-gets", text: "What you get", style: "caps", w: 102, h: 15, bg: "#F3F6FF" },
};
export const nextTitleFor = (group: "likely" | "onsite") => (group === "onsite" ? "Want to jump the queue?" : "Hold your place in line");
