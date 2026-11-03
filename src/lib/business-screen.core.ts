// My business (installer screens Task 9; approved mock-up biz-phone.png, Jo 2 Nov 2026): the Needs you box, the seven
// folded rows, and the who-books setting Part 6 reads. Pure: no database, no network. Expiry facts come only from the
// existing credential rules (latestExpiry); gates stay with Part 9.
import { businessNext, latestExpiry, type CredentialView } from "./trade-view.core";
import { fmtDay } from "./next-step-dates.core";
import { melbourneYmd } from "./piesa-windows.core";

// Wording. Lines from the plan's Global Constraints are approved; every DRAFT line is listed for Jo (Task 12 paste).
export const BUSINESS_WORDS = {
  title: "My business", // approved
  sub: "Everything we need from you to keep working.", // approved
  needsYou: "NEEDS YOU", // approved
  rows: { team: "Team", electricians: "Electricians", insurance: "Insurance and licences", details: "Business details", rates: "Your rates", bank: "Bank details", agreement: "Agreement and ESC notice" }, // approved (plan Task 9 titles)
  uploadLogo: "Upload your logo (for co-branded quotes)", // DRAFT
  logoRule: "PNG or JPEG, up to 2 MB. It goes on the quotes we send your own customers.", // DRAFT
  logoSaved: "Logo saved", // DRAFT
  whoBooksSaved: "Saved", // DRAFT
  noElectricians: "No electricians on your Team yet", // DRAFT
  noPiesaPrice: "no PIESA price yet", // DRAFT
  noOfficePhone: "No office phone", // DRAFT
  logoYes: "logo ✓", // DRAFT
  logoNo: "no logo yet", // DRAFT
  signed: "Signed ✓", // DRAFT
  notSigned: "Not signed yet", // DRAFT
  noticeToAck: (n: number) => `${n} to acknowledge the ESC notice`, // DRAFT
  bankMissing: "Add where we pay you", // existing (trade-view.core bankLine)
  ratesPending: "Being confirmed with the office", // existing (trade-view.core ratesLine)
} as const;

// ---- Who books the safety check and the upgrades day (Part 6 reads `whoBooksOf(businesses.piesa_booked_by)`) ----------
export type WhoBooks = "office" | "electrician" | "either";
export const WHO_BOOKS_LABEL: Record<WhoBooks, string> = { office: "Our office", electrician: "Our electrician", either: "Either (whoever goes first)" }; // approved
export const WHO_BOOKS_QUESTION = "Who books the safety check and the upgrades day?"; // DRAFT
/** Missing column, null or an unknown value all read as "office" (the default the pending SQL sets). */
export function whoBooksOf(raw: unknown): WhoBooks {
  return raw === "electrician" || raw === "either" ? raw : "office";
}

// ---- Logo ---------------------------------------------------------------------------------------------------------------
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES: Record<string, "png" | "jpg"> = { "image/png": "png", "image/jpeg": "jpg" };
/** Why a logo file can't be taken (null = fine). Type by the declared MIME and the file's own first bytes. */
export function logoFileProblem(f: { type: string; bytes: Uint8Array }): string | null {
  const ext = LOGO_TYPES[f.type];
  if (!ext) return "The logo must be a PNG or JPEG image."; // DRAFT
  if (f.bytes.byteLength === 0) return "The file is empty."; // DRAFT
  if (f.bytes.byteLength > LOGO_MAX_BYTES) return "The logo must be 2 MB or smaller."; // DRAFT
  const b = f.bytes;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if ((ext === "png" && !png) || (ext === "jpg" && !jpg)) return "That file isn't a PNG or JPEG image."; // DRAFT
  return null;
}

// ---- The screen ---------------------------------------------------------------------------------------------------------
export type BusinessScreenFacts = {
  team: { people: number; missingDobOrMobile: number };
  electricians: { name: string; business: string | null; piesaPrice: number | null }[];
  credentials: CredentialView[];
  officePhone: string | null; logoUrl: string | null;
  ratesAgreedAt: string | null; hasRates: boolean;
  bankLast4: string | null; bankSaved: boolean;
  agreementSigned: boolean; noticeOutstanding: { name: string }[]; ciiBlocked: { name: string }[];
};
export type NeedsYou = { title: string; sub: string; button: string; to: string } | null;

const daysUntil = (ymd: string, today: string) => Math.round((Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
const dayMonthOf = (ymd: string) => fmtDay(ymd.slice(0, 10)).split(" ").slice(1).join(" ");
const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** The ONE thing on the screen. Public liability within 30 days (plan Task 9 wording) wins; then the existing M7 order
 *  (bank, ESC notice, CII, agreement) with its approved words; a usual electrician is never asked for (Task 9 removed it). */
export function needsYou(f: BusinessScreenFacts, today: string): NeedsYou {
  const pl = latestExpiry(f.credentials, "public_liability_insurance");
  if (pl != null) {
    const d = daysUntil(pl, today);
    if (d >= 0 && d <= 30) {
      return {
        title: d === 0 ? "Public liability expires today" : `Public liability expires in ${d} day${d === 1 ? "" : "s"}`, // plan Task 9
        sub: `Upload the new certificate. Our office checks it before your jobs can carry on after ${dayMonthOf(pl)}.`, // plan Task 9
        button: "Upload certificate", to: "/field/business/insurance", // plan Task 9
      };
    }
  }
  return businessNext({ installer: true, publicLiabilityExpires: pl, bankSaved: f.bankSaved, agreementSigned: f.agreementSigned, noticeOutstanding: f.noticeOutstanding, usualElectrician: true, ciiBlocked: f.ciiBlocked }, today);
}

export function businessRows(f: BusinessScreenFacts, today: string): { title: string; sub: string; to: string; warn: boolean }[] {
  const W = BUSINESS_WORDS;
  const people = `${f.team.people} ${f.team.people === 1 ? "person" : "people"}`;
  const teamSub = f.team.missingDobOrMobile === 0 ? `${people} · all have date of birth + mobile ✓` : `${people} · ${f.team.missingDobOrMobile} missing date of birth or mobile`; // DRAFT
  const elecSub = f.electricians.length
    ? f.electricians.map((e) => `${e.name}${e.business ? ` (${e.business})` : ""} · ${e.piesaPrice != null ? `PIESA price ${money(e.piesaPrice)}` : W.noPiesaPrice}`).join(" · ")
    : W.noElectricians;
  const cover = (kind: string, name: string) => {
    const exp = latestExpiry(f.credentials, kind);
    if (exp == null) return { t: `${name} not on file`, warn: true };
    const d = daysUntil(exp, today);
    if (d < 0) return { t: `${name} expired`, warn: true };
    if (d <= 30) return { t: `${name} expiring`, warn: true };
    return { t: `${name} ✓`, warn: false };
  };
  const wc = cover("workers_comp_insurance", "Workers comp"), pl = cover("public_liability_insurance", "Public liability");
  const detailsSub = `${f.officePhone ? `Office ${f.officePhone}` : W.noOfficePhone} · ${f.logoUrl ? W.logoYes : W.logoNo}`;
  const ratesSub = f.hasRates ? `Agreed ${f.ratesAgreedAt ? dayMonthOf(f.ratesAgreedAt.length === 10 ? f.ratesAgreedAt : melbourneYmd(new Date(f.ratesAgreedAt))) : ""}`.trim() : W.ratesPending;
  const bankSub = f.bankSaved && f.bankLast4 ? `••••${f.bankLast4}` : W.bankMissing;
  const agreementSub = [f.agreementSigned ? W.signed : W.notSigned, f.noticeOutstanding.length ? W.noticeToAck(f.noticeOutstanding.length) : null].filter(Boolean).join(" · ");
  return [
    { title: W.rows.team, sub: teamSub, to: "/field/business/team", warn: f.team.missingDobOrMobile > 0 },
    { title: W.rows.electricians, sub: elecSub, to: "/field/business/electrician", warn: !f.electricians.length },
    { title: W.rows.insurance, sub: `${wc.t} · ${pl.t}`, to: "/field/business/insurance", warn: wc.warn || pl.warn },
    { title: W.rows.details, sub: detailsSub, to: "/field/business/details", warn: !f.officePhone },
    { title: W.rows.rates, sub: ratesSub, to: "/field/business/rates", warn: !f.hasRates },
    { title: W.rows.bank, sub: bankSub, to: "/field/business/bank", warn: !f.bankSaved },
    { title: W.rows.agreement, sub: agreementSub, to: "/field/business/agreement", warn: !f.agreementSigned || f.noticeOutstanding.length > 0 },
  ];
}
