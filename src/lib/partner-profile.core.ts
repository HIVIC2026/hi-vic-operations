// One tidy partner business profile built from a signed onboarding application, plus office review flags.
// Pure: labels and normalises facts already given; it never approves, blocks or changes workflow.

export type ProfileType = "installer" | "electrician" | "both";
type Data = Record<string, unknown>;
type Addr = { suburb?: string | null; postcode?: string | null; latitude?: number | null; longitude?: number | null } | null;

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export const normaliseAbn = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length ? d : null; };
export const normaliseEmail = (v: unknown) => txt(v)?.toLowerCase() ?? null;
/** Australian mobile in +61 format (e.g. 0412 345 678 -> +61412345678). Anything else is kept trimmed. */
export function normaliseMobile(v: unknown): string | null {
  const raw = txt(v); if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (/^04\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  if (/^614\d{8}$/.test(d)) return `+${d}`;
  if (/^4\d{8}$/.test(d)) return `+61${d}`;
  return raw;
}

export type Credential = { kind: string; label: string; number: string | null; expires_at: string | null; issuer: string | null; has_file: boolean; verified: boolean; holder?: string | null };
export type PartnerProfile = {
  business: { legal_name: string | null; trading_name: string | null; abn: string | null; type: ProfileType; address: string | null; base_suburb: string | null; email: string | null; phone: string | null; gst_registered: boolean | null };
  signer: { name: string | null; position: string | null; mobile: string | null; email: string | null };
  workers: { name: string | null; role: "electrician" | "installer"; mobile: string | null; email: string | null }[];
  licences: Credential[];
  insurance: { amount: number | null; insurer: string | null; policy: string | null; expires_at: string | null; expiry_source: "typed_by_applicant"; has_file: boolean; verified: boolean };
  agreement: { version: string | null; signed_by: string | null; signed_at: string | null; has_copy: boolean };
  rates: { piesa: number | null; return_visit: number | null; r5_per_m2: number | null; batts_removal_per_m2: number | null; loose_fill_removal_per_m2: number | null; free_quotes: boolean | null; free_measure_ups: boolean | null };
  coverage: { base: string | null; lat: number | null; lng: number | null; radius_km: number | null; anywhere_in_victoria: boolean };
  capacity: { jobs_per_week: string | null };
  bank: { supplied: boolean };
};

export type AppMeta = {
  partner_type: string; signer_name: string | null; signer_position: string | null; signer_email: string | null;
  agreement_version: string | null; signed_at: string | null; agreement_text: string | null; insurance_certificate_path: string | null;
};

/** Office CII checks keyed by lower-case worker email. */
export type CiiCheck = { status: string; expires_on?: string | null };

export function buildPartnerProfile(app: AppMeta, data: Data, cii: Map<string, CiiCheck> = new Map(), existingCapabilities: string[] = []): PartnerProfile {
  const installer = app.partner_type === "installer";
  const caps = new Set([...existingCapabilities, installer ? "installer" : "electrician"]);
  const type: ProfileType = caps.has("installer") && caps.has("electrician") ? "both" : installer ? "installer" : "electrician";
  const origin = (data["service_origin_details"] ?? data["business_address_details"] ?? null) as Addr;
  const radius = num(data["travel_radius_km"]);
  const anywhere = radius === 9999;
  const signerMobile = normaliseMobile(data["business_phone"]);
  const people = (installer ? (data["installers"] as Data[] | undefined) : (data["electricians"] as Data[] | undefined)) ?? [];
  const workers = people.map((w) => ({ name: txt(w["full_legal_name"]), role: (installer ? "installer" : "electrician") as "installer" | "electrician", mobile: normaliseMobile(w["mobile"]), email: normaliseEmail(w["email"]) }));
  const licences: Credential[] = installer
    ? people.map((w) => {
        const email = normaliseEmail(w["email"]) ?? "";
        const check = cii.get(email);
        return { kind: "cii_certification", label: "CII certification", holder: txt(w["full_legal_name"]), number: w["cii_holds"] === "held" ? txt(w["cii_certificate_number"]) : null,
          issuer: txt(w["cii_issuer"]), expires_at: check?.expires_on ?? txt(w["cii_expiry"]), has_file: false, verified: check?.status === "verified" };
      })
    : [
        { kind: "rec_registration", label: "REC number", number: txt(data["rec_registration_number"]) ?? txt(data["host_rec_number"]), issuer: "Energy Safe Victoria", expires_at: null, has_file: false, verified: false },
        { kind: "esv_licence", label: "ESV electrical licence", holder: txt(data["primary_contact_name"]), number: txt(data["licence_number"]), issuer: "Energy Safe Victoria", expires_at: null, has_file: false, verified: false },
      ];
  if (installer) licences.push({ kind: "piisa_training", label: "PIISA training", number: null, issuer: null, expires_at: null, has_file: false, verified: false });
  return {
    business: {
      legal_name: txt(data["legal_entity_name"]), trading_name: txt(data["trading_name"]), abn: normaliseAbn(data["abn"]), type,
      address: txt(data["business_address"]), base_suburb: txt(origin?.suburb) ?? txt(data["service_origin"]),
      email: normaliseEmail(data["business_email"]), phone: signerMobile, gst_registered: typeof data["gst_registered"] === "boolean" ? (data["gst_registered"] as boolean) : null,
    },
    signer: { name: txt(app.signer_name) ?? txt(data["primary_contact_name"]), position: txt(app.signer_position), mobile: signerMobile, email: normaliseEmail(app.signer_email) ?? normaliseEmail(data["business_email"]) },
    workers,
    licences,
    insurance: { amount: num(data["public_liability_cover_amount"]), insurer: txt(data["insurer"]), policy: txt(data["insurance_policy_number"]), expires_at: txt(data["public_liability_expiry"]), expiry_source: "typed_by_applicant", has_file: !!app.insurance_certificate_path, verified: false },
    agreement: { version: app.agreement_version, signed_by: app.signer_name, signed_at: app.signed_at, has_copy: !!app.agreement_text },
    rates: {
      piesa: installer ? null : num(data["assessment_rate"]), return_visit: installer ? null : num(data["installation_attendance_rate"]),
      r5_per_m2: installer ? num(data["r5_rate"]) : null, batts_removal_per_m2: installer ? num(data["batts_removal_rate"]) : null, loose_fill_removal_per_m2: installer ? num(data["loose_fill_removal_rate"]) : null,
      free_quotes: installer && typeof data["free_quotes_for_hivic_leads"] === "boolean" ? (data["free_quotes_for_hivic_leads"] as boolean) : null,
      free_measure_ups: installer && typeof data["free_measureups_for_hivic_quote_leads"] === "boolean" ? (data["free_measureups_for_hivic_quote_leads"] as boolean) : null,
    },
    coverage: { base: txt(data["service_origin"]), lat: num(origin?.latitude), lng: num(origin?.longitude), radius_km: anywhere ? null : radius, anywhere_in_victoria: anywhere },
    capacity: { jobs_per_week: txt(data["capacity_band"]) },
    bank: { supplied: !!(txt(data["bank_account_name"]) && txt(data["bank_bsb"]) && txt(data["bank_account_number"])) },
  };
}

export const TYPICAL_R5 = [25, 30] as const;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);

/** Review flags shown on the approval screen. Information only: approval is never blocked by these. */
export function approvalFlags(p: PartnerProfile, peers: { r5: number[]; piesa: number[] }, today: string): string[] {
  const out: string[] = [];
  const isInstaller = p.business.type !== "electrician";
  if (isInstaller) {
    const cii = p.licences.filter((l) => l.kind === "cii_certification");
    if (!cii.length || cii.some((c) => !c.number)) out.push("Missing CII certification number for an installer.");
    if (cii.some((c) => c.number && !c.verified)) out.push("CII certification not yet verified by the office.");
    if (cii.some((c) => c.number && !c.expires_at)) out.push("Missing CII certification expiry date.");
    out.push("PIISA training not recorded in the application.");
  } else {
    if (!p.licences.find((l) => l.kind === "rec_registration")?.number) out.push("Missing REC number.");
    if (!p.licences.find((l) => l.kind === "esv_licence")?.number) out.push("Missing ESV licence number.");
    out.push("Missing licence expiry (the form does not ask for it yet).");
  }
  const unusual = (label: string, v: number | null, xs: number[]) => {
    const m = median(xs.filter((x) => x > 0)); if (v == null || m == null || xs.length < 3) return;
    if (v < m * 0.75 || v > m * 1.35) out.push(`${label} $${v} looks unusual (other partners: around $${Math.round(m)}).`);
  };
  // Too few real installers to compare yet, so fall back to Jo's stated typical R5 range ($25–30/m²).
  if (peers.r5.length >= 3) unusual("R5 rate per m²", p.rates.r5_per_m2, peers.r5);
  else if (p.rates.r5_per_m2 != null && (p.rates.r5_per_m2 < TYPICAL_R5[0] * 0.85 || p.rates.r5_per_m2 > TYPICAL_R5[1] * 1.2)) out.push(`R5 rate per m² $${p.rates.r5_per_m2} looks unusual (typical: $${TYPICAL_R5[0]}–${TYPICAL_R5[1]}).`);
  unusual("PIESA rate", p.rates.piesa, peers.piesa);
  if (!p.insurance.expires_at) out.push("Missing public liability expiry date.");
  else { const d = daysUntil(p.insurance.expires_at, today); if (d < 0) out.push("Public liability insurance has expired."); else if (d <= 60) out.push(`Public liability insurance expires in ${d} days.`); }
  if (p.insurance.amount != null && p.insurance.amount < 5_000_000) out.push("Public liability cover is under $5 million.");
  if (!p.insurance.has_file) out.push("No insurance certificate uploaded.");
  if (p.insurance.expires_at) out.push("Insurance expiry was typed by the applicant — check it against the certificate.");
  if (p.coverage.lat == null && !p.coverage.anywhere_in_victoria) out.push("Base location has no map point.");
  if (!p.bank.supplied) out.push("Bank details not supplied.");
  return out;
}
