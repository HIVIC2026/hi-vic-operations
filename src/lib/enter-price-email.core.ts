// "Enter your price" email (new job flow Part 10 Task 3; Jo 3 Nov 2026 22:58 ruling). When an A1 (installer's own
// customer) Ready Check is marked Complete and the business owner has not entered a price, the BOSS gets BOTH the
// decision-288 text ("{HV} Ready Check done at {street}. Enter your price: {link}") AND this email — the plan's
// "never both" is overridden. One claim per job (`boss_price_link_sent`, boss-price-link.core) covers the pair; the email
// is its own channel under that claim (`enterPriceEmailKey`), so a held email is retried on a later sync without the
// text going again, and a sent text is never followed by a second text.
//
// DRAFT: `ENTER_PRICE_EMAIL_APPROVED = false` until Jo approves the subject and the pronoun. Body wording is the approved
// price-email.png mock verbatim; the mock says "her" — the draft says "them" because the owner's gender isn't recorded.
// Real partner + flag off → held, recorded once (`enter_price_email_held`); TEST job / TEST partner → test-send so Jo
// sees the draft. Pure: wording, facts from the Ready Check answers, the plan and the keys. No I/O.
import { bossPriceLinkKey } from "./boss-price-link.core";
import { NOT_ON_READY_CHECK } from "./installer-price.core";
import { partnerEmailLayout, type PartnerBlock } from "./partner-email.core";
import { LEAN_Q } from "./ready-check-lean.core";
import { areasFromReadyCheckEntries } from "./area-diagram.core";

/** DRAFT until Jo approves the subject ("{HV}: Ready Check done. Time to price it.") and the pronoun ("them"). */
export const ENTER_PRICE_EMAIL_APPROVED: boolean = false;

/** Recorded ONCE per job when the email is held (flag off / no office email / trade messages paused); internal. */
export const ENTER_PRICE_EMAIL_HELD_EVENT = "enter_price_email_held" as const;
/** `customer_email_sends.purpose` for the one attempt per job. */
export const ENTER_PRICE_EMAIL_PURPOSE = "enter_price_email" as const;
/** The email channel's key under the one decision-288 claim for the job. */
export const enterPriceEmailKey = (jobId: string) => `${bossPriceLinkKey(jobId)}:email`;
/** The email is only ever sent while the Ready Check completion is this fresh (same 24h as the text's SMS_FRESHNESS). */
export const ENTER_PRICE_EMAIL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type EnterPriceFacts = {
  recipientFirst: string | null; checkerFirst: string | null; ownerFirst: string | null; ownerFull: string;
  jobNumber: string; address: string; readyCheckOn: string /* "Tue 4 Nov" */;
  measured: string; existing: string; removal: string; roof: string; access: string; product: string; downlights: string;
  builtLast5Years: "Yes" | "No" | null; lifeSupport: "Yes" | "No" | null;
  priceUrl: string; readyCheckPdfUrl: string | null; test?: boolean;
};

/** DRAFT subject (Jo to approve). */
export const enterPriceSubject = (jobNumber: string) => `${jobNumber}: Ready Check done. Time to price it.`;

const yesNoOr = (v: "Yes" | "No" | null) => v ?? NOT_ON_READY_CHECK;

/** The approved body (price-email.png) in the partner email look; link = the boss's "Your price" card. */
export function renderEnterPriceEmail(f: EnterPriceFacts): { subject: string; html: string; text: string; mjml: string } {
  const subject = enterPriceSubject(f.jobNumber);
  const checker = f.checkerFirst?.trim() || "your team";
  const ownerPlace = f.ownerFirst?.trim() ? `${f.ownerFirst.trim()}'s place` : "the owner's place";
  const rows: [string, string][] = [
    ["Measured ceiling", f.measured], ["Existing insulation", f.existing], ["Removal needed", f.removal], ["Roof", f.roof],
    ["Access", f.access], ["Product chosen", f.product], ["Downlights", f.downlights],
  ];
  const blocks: PartnerBlock[] = [
    { kind: "hi", text: `Hi ${f.recipientFirst?.trim() || "there"},` },
    { kind: "p", text: `Here's what ${checker} found at ${ownerPlace}. Enter your price and Home Insulation Victoria sends them the quote straight away.` },
    {
      kind: "card", title: `${f.jobNumber} · ${f.ownerFull}`, subtitle: `${f.address} · Ready Check ${f.readyCheckOn}`,
      blocks: [
        ...rows.map(([k, v]): PartnerBlock => ({ kind: "p", text: `${k}: ${v}` })),
        { kind: "p", text: `Built in last 5 years: ${yesNoOr(f.builtLast5Years)} · Life support: ${yesNoOr(f.lifeSupport)}` },
      ],
    },
    { kind: "button", label: "Enter your price", url: f.priceUrl },
    { kind: "small", text: "Your price stays editable until the quote is sent." },
    ...(f.readyCheckPdfUrl ? [{ kind: "link", label: "See the full Ready Check ›", url: f.readyCheckPdfUrl } as PartnerBlock] : []),
  ];
  const m = partnerEmailLayout({ subject, heading: "Ready Check done. Time to price it.", blocks, preview: `${f.jobNumber} Ready Check done — enter your price`, test: f.test === true });
  return { subject, ...m };
}

export type EnterPriceEmailPlan =
  | { action: "done" }
  | { action: "held"; reason: string }
  | { action: "send" | "test_send"; to: string };

/**
 * What to do with the email channel this sync. `alreadyAttempted` = a `customer_email_sends` row under the email key
 * exists (one attempt per job, never retried after a send or a failure). `fresh` = the Ready Check completion is within
 * `ENTER_PRICE_EMAIL_MAX_AGE_MS` (a flag flip never fires old emails). Held reasons are retried on later syncs while fresh.
 */
export function enterPriceEmailPlan(p: { approved: boolean; test: boolean; officeEmail: string | null | undefined; paused: string | null; alreadyAttempted: boolean; fresh: boolean }): EnterPriceEmailPlan {
  if (p.alreadyAttempted || !p.fresh) return { action: "done" };
  if (!p.test && !p.approved) return { action: "held", reason: "email wording not approved yet (ENTER_PRICE_EMAIL_APPROVED)" };
  const to = p.officeEmail?.trim();
  if (!to) return { action: "held", reason: "no office email on file for the installer" };
  if (p.paused) return { action: "held", reason: p.paused };
  return { action: p.test ? "test_send" : "send", to };
}

export const enterPriceFresh = (completedAt: string | null, nowIso: string): boolean => {
  const at = completedAt ? Date.parse(completedAt) : NaN;
  return Number.isFinite(at) && Date.parse(nowIso) - at <= ENTER_PRICE_EMAIL_MAX_AGE_MS;
};

/** "Wed 4 Nov" in Melbourne time; the placeholder when the completion time is unknown. */
export function readyCheckDayLabel(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return NOT_ON_READY_CHECK;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

const firstName = (full: string | null | undefined): string | null => (full ?? "").trim().split(/\s+/)[0] || null;
const norm = (s: unknown) => String(s ?? "").split("\n")[0]!.trim().toLowerCase();
const num = (v: unknown): number | null => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null; };
const yes = (v: unknown) => /^\s*(yes|y|true)\b/i.test(String(v ?? ""));
const no = (v: unknown) => /^\s*(no|n|false)\b/i.test(String(v ?? ""));
const m2 = (n: number) => `${Math.round(n)} m²`;

export type EnterPriceContext = {
  recipientName: string | null; checkerName: string | null; ownerName: string | null;
  jobNumber: string; address: string; completedAt: string | null;
  /** The current ceiling measurement (the quote's source); null = none yet. */
  measuredAreaM2: number | null; removalRequired: boolean | null;
  priceUrl: string; readyCheckPdfUrl: string | null;
};

/**
 * The email's rows from the Ready Check answers (the stored form snapshot — the same entries the quote reads) plus the
 * current measurement. Anything missing = `NOT_ON_READY_CHECK`; nothing is guessed.
 */
export function enterPriceFacts(entries: { label: string; value: string | null }[], c: EnterPriceContext): EnterPriceFacts {
  const find = (label: string): string | null => {
    const hit = entries.find((e) => norm(e.label) === norm(label) && e.value != null && String(e.value).trim() !== "");
    return hit ? String(hit.value).trim() : null;
  };
  const all = (label: string): string[] => entries.filter((e) => norm(e.label) === norm(label) && e.value != null && String(e.value).trim() !== "").map((e) => String(e.value).trim());
  const areas = areasFromReadyCheckEntries(entries);
  const formM2 = areas.reduce((a, x) => a + (x.areaM2 ?? 0), 0) || null;
  const total = c.measuredAreaM2 && c.measuredAreaM2 > 0 ? c.measuredAreaM2 : formM2;
  const areaCount = Math.max(areas.length, 1);
  const measured = total ? `${m2(total)} (${areaCount} ${areaCount === 1 ? "area" : "areas"})` : NOT_ON_READY_CHECK;
  const existingAnswers = all(LEAN_Q.existing);
  const types = [...new Set(all(LEAN_Q.existingType).flatMap((v) => v.split(/\s*[,;]\s*/)).filter(Boolean))];
  const r = all(LEAN_Q.rValue).map(num).find((n): n is number => n != null) ?? null;
  const existing = existingAnswers.length && existingAnswers.every(no) ? "None"
    : existingAnswers.some(yes) || types.length || r != null ? [types.join(", ") || "Yes", r != null ? `R${r.toFixed(1)}` : null].filter(Boolean).join(", ") : NOT_ON_READY_CHECK;
  const removeM2 = all(LEAN_Q.removeM2).map(num).filter((n): n is number => n != null).reduce((a, b) => a + b, 0);
  const removal = c.removalRequired === false ? "None" : removeM2 > 0 ? m2(removeM2) : c.removalRequired === true ? "Yes" : NOT_ON_READY_CHECK;
  const dl = all(LEAN_Q.downlights);
  const dlCount = all(LEAN_Q.downlightsCount).map(num).filter((n): n is number => n != null).reduce((a, b) => a + b, 0);
  const downlights = dl.length && dl.every(no) ? "None" : dlCount > 0 ? String(dlCount) : dl.some(yes) ? "Yes" : NOT_ON_READY_CHECK;
  const yn = (v: string | null): "Yes" | "No" | null => (v == null ? null : yes(v) ? "Yes" : no(v) ? "No" : null);
  const ownerFull = c.ownerName?.trim() || find(LEAN_Q.ownerName) || "the owner";
  return {
    recipientFirst: firstName(c.recipientName), checkerFirst: firstName(c.checkerName),
    ownerFirst: ownerFull === "the owner" ? null : firstName(ownerFull), ownerFull,
    jobNumber: c.jobNumber, address: c.address, readyCheckOn: readyCheckDayLabel(c.completedAt),
    measured, existing, removal,
    roof: find(LEAN_Q.roofType) ?? NOT_ON_READY_CHECK, access: find(LEAN_Q.access) ?? NOT_ON_READY_CHECK,
    product: find(LEAN_Q.product) ?? NOT_ON_READY_CHECK, downlights,
    builtLast5Years: yn(find(LEAN_Q.builtLast5)), lifeSupport: yn(find(LEAN_Q.lifeSupport)),
    priceUrl: c.priceUrl, readyCheckPdfUrl: c.readyCheckPdfUrl,
  };
}
