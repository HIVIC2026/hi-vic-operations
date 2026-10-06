// Light helpers for campaign email brand images (no fonts loaded here, safe for the browser preview bundle).
// The images themselves are drawn by email-hero.core.ts at /api/public/email-art/{token}/{kind}.png.
export type EmailArtKind = "headline" | "spot" | "pay";
const OUTFIT_800_ADV: Record<string, number> = { "0": 0.671, "1": 0.39, "2": 0.576, "3": 0.569, "4": 0.613, "5": 0.568, "6": 0.579, "7": 0.53, "8": 0.569, "9": 0.579, "$": 0.613, ",": 0.287, ".": 0.304 };
export const AMOUNT_SIZE = 34, AMOUNT_LH = 38;
/** Display width (1x px) of an amount drawn in Outfit 800 at 34px; used for both the PNG and the <img width>. */
export function amountArtWidth(text: string) { return Math.ceil([...text].reduce((w, c) => w + (OUTFIT_800_ADV[c] ?? 0.6) * AMOUNT_SIZE, 0)) + 4; }
export function emailArtUrl(origin: string, token: string, kind: EmailArtKind) { return `${origin}/api/public/email-art/${token}/${kind}.png`; }
