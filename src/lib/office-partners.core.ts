// Office O5 Partners (decisions 153, 130, 22/188, 157/173, 229, 232): pure presentation rules for the People,
// Approved, Rates and Coverage tabs and the business file. No database, no network. Clearance itself is decided by
// worker-compliance.core `crewClearance` (decision 153) — this file only words the facts and picks ONE next action.
import type { MittiAccess } from "./mitti-membership.core";

export type PersonFacts = {
  role: string;
  /** worker-compliance.core eecState: missing | awaiting_check | verified | rejected | not_applicable */
  eec: string;
  /** Recorded CII level + expiry and the derived clearance (verified installers only). */
  cii: { level: string | null; expiresOn: string | null; cleared: boolean; reason: string | null } | null;
  licenceNumber?: string | null;
  licenceExpiresOn?: string | null;
  /** ESC privacy collection notice (decision 130): true acknowledged, false outstanding, null not applicable. */
  noticeAck: boolean | null;
  /** First notice link sent (for "Outstanding 7d"). */
  noticeFirstSentAt: string | null;
  mitti: MittiAccess | null;
};

export type PersonAction = "verify_cii" | "send_notice" | "invite_mitti" | null;
export type PersonRow = { ciiLabel: string; ciiTone: "green" | "rose" | "amber" | "plain"; noticeLabel: string; noticeTone: "green" | "rose" | "plain"; mittiLabel: string; inMitti: boolean; action: PersonAction };

const fmt = (ymd: string | null | undefined, withYear = true) => {
  if (!ymd) return "";
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00+11:00`);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "Australia/Melbourne" });
};
const days = (fromIso: string, today: string) => Math.max(0, Math.floor((Date.parse(`${today}T12:00:00+11:00`) - Date.parse(fromIso)) / 86_400_000));

/** One row of Partners › People. The action is the first missing step in decision order: CII (153) → notice (130) → Mitti (22/188). */
export function personRow(p: PersonFacts, today: string): PersonRow {
  let ciiLabel = "—", ciiTone: PersonRow["ciiTone"] = "plain";
  if (p.role === "installer") {
    if (p.eec === "verified" && p.cii?.level && p.cii.expiresOn) {
      const soon = p.cii.expiresOn < today ? "expired" : (Date.parse(p.cii.expiresOn) - Date.parse(today)) / 86_400_000 <= 60 ? "soon" : "ok";
      ciiLabel = `${p.cii.level === "full" ? "Full" : p.cii.level === "provisional" ? "Provisional" : `Level ${p.cii.level}`} · ${soon === "expired" ? "expired" : "to"} ${fmt(p.cii.expiresOn, soon !== "soon")}`;
      ciiTone = p.cii.cleared ? (soon === "soon" ? "amber" : "green") : "rose";
    } else if (p.eec === "verified") { ciiLabel = "Verified · level and expiry to record"; ciiTone = "rose"; }
    else if (p.eec === "rejected") { ciiLabel = "Not accepted"; ciiTone = "rose"; }
    else if (p.eec === "awaiting_check") { ciiLabel = "To verify"; ciiTone = "rose"; }
    else { ciiLabel = "Not uploaded"; ciiTone = "rose"; }
  } else if (p.role === "electrician") {
    ciiLabel = p.licenceNumber ? `Licence ${p.licenceNumber}${p.licenceExpiresOn ? ` · to ${fmt(p.licenceExpiresOn)}` : ""}` : "Licence to record";
    ciiTone = p.licenceExpiresOn && p.licenceExpiresOn >= today ? "plain" : "amber";
  }
  const noticeLabel = p.noticeAck == null ? "—" : p.noticeAck ? "Acknowledged" : p.noticeFirstSentAt ? `Outstanding ${days(p.noticeFirstSentAt, today)}d` : "Not sent yet";
  const noticeTone: PersonRow["noticeTone"] = p.noticeAck == null ? "plain" : p.noticeAck ? "green" : "rose";
  const inMitti = p.mitti === "member";
  const mittiLabel = p.mitti == null ? "No login yet" : inMitti ? "Yes" : p.mitti === "unchecked" ? "Not checked" : p.mitti === "email_changed" ? "Email changed" : "No";
  const needsCii = p.role === "installer" && !(p.eec === "verified" && p.cii?.cleared);
  const action: PersonAction = needsCii && p.eec !== "missing" ? "verify_cii" : p.noticeAck === false ? "send_notice" : !inMitti ? "invite_mitti" : null;
  return { ciiLabel, ciiTone, noticeLabel, noticeTone, mittiLabel, inMitti, action };
}

/** "3145–3170 · 3199" from a postcode list (wildcards like 31* kept as written). */
export function postcodeSummary(postcodes: readonly string[] | null | undefined): string {
  const plain = [...new Set((postcodes ?? []).filter((p) => /^\d{4}$/.test(p)).map(Number))].sort((a, b) => a - b);
  const wild = (postcodes ?? []).filter((p) => p.includes("*"));
  const runs: string[] = [];
  for (let i = 0; i < plain.length; i++) {
    let j = i;
    while (j + 1 < plain.length && plain[j + 1]! - plain[j]! <= 5) j++;
    runs.push(i === j ? String(plain[i]) : `${plain[i]}–${plain[j]}`);
    i = j;
  }
  return [...runs, ...wild].join(" · ") || "None verified";
}

const RATE_LABEL: Record<string, string> = {
  R5_BATTS: "R5.0 batts", R4_BATTS: "R4.0", R6_BATTS: "R6.0", R7_BATTS: "R7.0", TOPUP_R5: "Top-up over existing", MIN_JOB: "min job", MINIMUM_JOB: "min job",
  BATTS_REMOVAL: "removal", REMOVAL: "removal", LOOSE_FILL_REMOVAL: "loose-fill removal", VACUUM_ONLY: "vacuum only",
};
/** One line per rate card: "R5.0 batts $24.50/m² · R4.0 $21.00/m² · min job $900" (ex GST, as agreed). */
export function rateCardLine(items: readonly { code: string; unit_price_ex_gst: number; unit?: string | null }[]): string {
  const known = items.filter((i) => RATE_LABEL[i.code]);
  if (!known.length) return items.length ? `${items.length} items` : "No items";
  return known.slice(0, 4).map((i) => `${RATE_LABEL[i.code]} $${Number(i.unit_price_ex_gst).toFixed(2)}${i.unit === "m2" || /BATTS|REMOVAL|TOPUP|VACUUM/.test(i.code) ? "/m²" : ""}`).join(" · ") + (known.length > 4 ? ` + ${known.length - 4} more` : "");
}

/** Mask bank details for the business file (decision: full details only behind a logged reveal). */
export function maskBank(b: { account_name: string; bsb: string; account_number: string } | null): { accountName: string; bsb: string; account: string } | null {
  if (!b) return null;
  const bsb = b.bsb.replace(/\D/g, "");
  const acc = b.account_number.replace(/\D/g, "");
  return { accountName: b.account_name, bsb: `${bsb.slice(0, 3)}-•••`, account: `••••${acc.slice(-4)}` };
}

export type CheckMark = "ok" | "warn" | "missing";
export type ApplicationCheck = { mark: CheckMark; text: string };
type AppData = {
  abn?: string; insurer?: string; public_liability_cover_amount?: number | null; public_liability_expiry?: string; insurance_uploaded?: boolean;
  installers?: { full_legal_name?: string; email?: string; cii_holds?: string | null; cii_level?: string | null; cii_expiry?: string }[];
  r5_rate?: number | null; assessment_rate?: number | null; rec_registration_number?: string; licence_number?: string; licence_expiry?: string;
  bank_account_name?: string; bank_bsb?: string; bank_account_number?: string;
};

/**
 * O5 application review "Checks before approval" (decision 232). Facts only, from the signed application; it never
 * approves anything — activatePartnerApplication keeps every guard (a verified CII is mandatory, expired insurance
 * needs an office override reason).
 */
export function applicationChecks(f: { type: "installer" | "rec"; data: AppData; signedAt: string | null; signerName: string | null; agreementVersion: string | null; hasCertificate: boolean; verifiedCiiEmails: readonly string[]; today: string }): ApplicationCheck[] {
  const d = f.data;
  const out: ApplicationCheck[] = [];
  const abn = (d.abn ?? "").replace(/\D/g, "");
  out.push(abn.length === 11 ? { mark: "ok", text: `ABN given · ${abn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}` } : { mark: "missing", text: "ABN not given" });
  const plOk = !!d.public_liability_expiry && d.public_liability_expiry >= f.today;
  const cover = d.public_liability_cover_amount ? `$${Math.round(d.public_liability_cover_amount / 1_000_000)}m · ` : "";
  out.push(plOk && f.hasCertificate ? { mark: "ok", text: `Public liability ${cover}${d.insurer ? `${d.insurer} · ` : ""}to ${d.public_liability_expiry} · certificate uploaded` }
    : plOk ? { mark: "warn", text: `Public liability ${cover}to ${d.public_liability_expiry} · certificate not uploaded` }
    : { mark: "missing", text: d.public_liability_expiry ? `Public liability expired ${d.public_liability_expiry}` : "Public liability insurance not given" });
  out.push(f.signedAt ? { mark: "ok", text: `Agreement ${f.agreementVersion ?? ""} signed by ${f.signerName ?? "the applicant"} · ${f.signedAt.slice(0, 10)}` } : { mark: "missing", text: "Agreement not signed yet" });
  if (f.type === "installer") {
    out.push(d.r5_rate ? { mark: "ok", text: `Schedule of rates proposed · R5.0 $${d.r5_rate}/m²` } : { mark: "missing", text: "No rates proposed" });
    const ws = d.installers ?? [];
    const verified = ws.filter((w) => f.verifiedCiiEmails.includes((w.email ?? "").trim().toLowerCase())).length;
    const notHeld = ws.filter((w) => w.cii_holds !== "held").map((w) => (w.full_legal_name ?? w.email ?? "installer").trim());
    out.push(!ws.length ? { mark: "missing", text: "No installers listed" }
      : verified === ws.length ? { mark: "ok", text: `CII certificates · all ${ws.length} verified` }
      : { mark: verified > 0 ? "warn" : "missing", text: `CII certificates · ${verified} of ${ws.length} verified${notHeld.length ? ` (${notHeld.join(", ")}: not held)` : ""}${verified === 0 ? " — at least one must be verified before approval" : ""}` });
  } else {
    out.push(d.assessment_rate ? { mark: "ok", text: `PIESA rate proposed · $${d.assessment_rate}` } : { mark: "missing", text: "No PIESA rate proposed" });
    out.push(d.rec_registration_number ? { mark: "ok", text: `REC ${d.rec_registration_number}` } : { mark: "missing", text: "REC number not given" });
    out.push(d.licence_number && d.licence_expiry && d.licence_expiry >= f.today ? { mark: "ok", text: `Electrical licence ${d.licence_number} · to ${d.licence_expiry}` } : { mark: "missing", text: "Electrical licence or its expiry missing" });
  }
  const acc = (d.bank_account_number ?? "").replace(/\D/g, "");
  out.push(d.bank_account_name && acc ? { mark: "ok", text: `Bank details given · ${d.bank_account_name} · ••••${acc.slice(-4)}` } : { mark: "warn", text: "Bank details not given (collected after approval)" });
  return out;
}

/** The default "Ask for the missing items" message: one line per outstanding check. */
export function missingItemsMessage(checks: readonly ApplicationCheck[]): string {
  const lines = checks.filter((c) => c.mark !== "ok").map((c) => `• ${c.text}`);
  return lines.length ? `Thanks for your application. Before we can approve it, please send us:\n${lines.join("\n")}` : "";
}
