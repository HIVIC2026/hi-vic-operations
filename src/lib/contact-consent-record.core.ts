// Contact consent as a record: who may call, for what, how, and until when. Pure; stored in the existing
// owner_contact_consents.snapshot column (no SQL). Withdrawal = latest owner_do_not_contact_set event.
import { endOfMelbourneYmd } from "./melbourne-time.core";
import { melbourneYmd } from "./piesa-windows.core";
import { DO_NOT_CONTACT_SET_EVENT } from "./do-not-contact.core";

export type ContactConsentSnapshot = { who: string[]; purpose: string; methods: ("phone" | "visit")[]; expiresAt: string; wording: string };

export const PHONE_CONSENT_MONTHS = 3;
export const CONSENT_PURPOSE = "to book and carry out ceiling insulation under the Victorian Energy Upgrades program";
const DEFAULT_WHO = "Home Insulation Victoria";

/** Jo 2 Nov, answer 15. Tom changes the website form (outside this repo). */
export const WEBSITE_CONSENT_WORDING = "I agree to Home Insulation Victoria and the EEC-certified installer it picks for me contacting me about my ceiling insulation.";
/** Set (in its own commit) once Tom confirms the new website consent line is live. */
export const WEBSITE_CONSENT_LIVE_FROM_ISO: string | null = null;

/** givenAt + PHONE_CONSENT_MONTHS calendar months, as the end of that Melbourne day (day clamped to month length). */
function consentExpiry(givenAt: string): string {
  const [y, m, d] = melbourneYmd(new Date(givenAt)).split("-").map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + PHONE_CONSENT_MONTHS;
  const ty = Math.floor(total / 12), tm = (total % 12) + 1;
  const day = Math.min(d, new Date(Date.UTC(ty, tm, 0)).getUTCDate());
  return endOfMelbourneYmd(`${ty}-${String(tm).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export function contactConsentSnapshot(i: { who: string[]; givenAt: string; wording: string }): ContactConsentSnapshot {
  return { who: [...i.who], purpose: CONSENT_PURPOSE, methods: ["phone", "visit"], expiresAt: consentExpiry(i.givenAt), wording: i.wording };
}

/** Phone consent lasts 3 months from when it was given (to the end of that Melbourne day). */
export function phoneConsentCurrent(consentedAt: string | null, nowIso: string): boolean {
  if (!consentedAt || !Number.isFinite(Date.parse(consentedAt))) return false;
  return Date.parse(nowIso) <= Date.parse(consentExpiry(consentedAt));
}

/** Wording to store for a website consent: the new line only for consents given at/after it went live. */
export function websiteConsentWording(consentedAt: string, formWording: string | null | undefined, liveFromIso: string | null = WEBSITE_CONSENT_LIVE_FROM_ISO): string {
  if (liveFromIso && Date.parse(consentedAt) >= Date.parse(liveFromIso)) return WEBSITE_CONSENT_WORDING;
  return formWording ?? "";
}

export type ContactConsentRecord = {
  who: string[]; purpose: string; methods: string[]; expiresAt: string | null; withdrawnAt: string | null; consentedAt: string | null; source: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.length && v.every((x) => typeof x === "string") ? (v as string[]) : null);

export function contactConsentRecord(
  rows: { consented_at: string | null; snapshot: unknown; source: string }[],
  dnc: { event_type: string; created_at: string }[],
): ContactConsentRecord | null {
  const granted = rows.filter((r) => !(isObj(r.snapshot) && r.snapshot["contact_consent"] === false));
  if (!granted.length) return null;
  const row = [...granted].sort((a, b) => Date.parse(b.consented_at ?? "") || 0 - (Date.parse(a.consented_at ?? "") || 0))[0]!;
  const snap = isObj(row.snapshot) ? row.snapshot : {};
  const expiresAt = typeof snap["expiresAt"] === "string" ? snap["expiresAt"] : row.consented_at ? consentExpiry(row.consented_at) : null;
  const withdrawn = dnc.filter((e) => e.event_type === DO_NOT_CONTACT_SET_EVENT).map((e) => e.created_at).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return {
    who: strs(snap["who"]) ?? [DEFAULT_WHO],
    purpose: typeof snap["purpose"] === "string" ? snap["purpose"] : CONSENT_PURPOSE,
    methods: strs(snap["methods"]) ?? ["phone", "visit"],
    expiresAt, withdrawnAt: withdrawn, consentedAt: row.consented_at, source: row.source,
  };
}
