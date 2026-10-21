import { ACTIVATABLE_INSTALLER_VERSIONS, INSTALLER_AGREEMENT_VERSION, normaliseInstallerDraft, type InstData, EXTRA_ITEMS } from "./installer-onboarding.core";
import { validCalendarDate } from "./rec-onboarding.core";
import { ACTIVATABLE_REC_VERSIONS, REC_AGREEMENT_VERSION, type RecData, RECT_ITEMS, customRateCode, effectiveElectricians, melbourneToday } from "./rec-onboarding.core";

export type PartnerType = "rec" | "installer";

export function activationWorkers(type: PartnerType, application: RecData | InstData, businessId: string, applicationId: string, certifications?: Map<string, CertVerification>) {
  if (type === "rec") return effectiveElectricians(application as RecData).map((worker) => ({
    business_id: businessId, trade_role: "electrician" as const,
    full_legal_name: worker.full_legal_name?.trim() ?? "", email: worker.email?.trim().toLowerCase() ?? "",
    mobile: worker.mobile?.trim() || null, licence_number: worker.licence_number?.trim() || null,
    licence_expires_on: worker.licence_expiry ?? null,
    qualification: null, source_application_id: applicationId,
  }));
  return ((application as InstData).installers ?? []).map((worker) => {
    const email = worker.email?.trim().toLowerCase() ?? "";
    const v = certifications?.get(email) ?? null;
    return {
      business_id: businessId, trade_role: "installer" as const,
      full_legal_name: worker.full_legal_name?.trim() ?? "", email,
      mobile: worker.mobile?.trim() || null, licence_number: null,
      // partner_workers_check requires a qualification for installers: use stated training, else the CII certificate the office checks.
      qualification: installerQualification(worker, v),
      source_application_id: applicationId,
      // Only an office verification counts; the applicant's own answer is kept as "declared".
      certification_status: v?.status ?? "unverified",
      piisa_status: worker.piisa_done === "yes" ? "done" as const : worker.piisa_done === "no" ? "not_done" as const : null,
      piisa_completed_on: worker.piisa_done === "yes" ? worker.piisa_date ?? null : null,
      piisa_certificate_path: ((application as InstData & { piisa_files?: Record<string, string> }).piisa_files ?? {})[email] ?? null,
      certification: { declared: { holds: worker.cii_holds ?? null, certificate_number: worker.cii_certificate_number ?? null, issuer: worker.cii_issuer ?? null, issue_date: worker.cii_issue_date ?? null }, verification_id: v?.id ?? null },
    };
  });
}

/**
 * Compatibility value for partner_workers.qualification (live CHECK: non-null for installers).
 * Descriptive only — never a verification; `certification_status` alone decides approval/assignment.
 */
export function installerQualification(worker: { qualification?: string | null; cii_holds?: string | null; cii_certificate_number?: string | null }, v?: CertVerification | null): string {
  const stated = worker.qualification?.trim();
  if (stated) return stated.slice(0, 300);
  const verifiedNum = v?.status === "verified" ? v.certificate_number?.trim() : "";
  if (verifiedNum) return `EEC CII ${verifiedNum} (office-verified)`;
  const basis = v?.status === "rejected" ? "not accepted" : "declared, not verified";
  const num = worker.cii_certificate_number?.trim();
  if (num) return `EEC CII ${num} (${basis})`;
  const held = worker.cii_holds === "held" ? "held" : worker.cii_holds === "in_training" ? "in training" : worker.cii_holds === "not_held" ? "not held" : "not stated";
  return `EEC CII ${held} (${basis})`;
}

export type CertVerification = { id: string; worker_email: string; status: "verified" | "rejected"; recorded_at: string; certificate_number?: string | null };
/** Latest office decision per worker email (append-only history; newest wins). */
export function latestCertifications(rows: CertVerification[]): Map<string, CertVerification> {
  const m = new Map<string, CertVerification>();
  for (const r of [...rows].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))) m.set(r.worker_email.trim().toLowerCase(), r);
  return m;
}
/** Office verification input rules: evidence source + note are mandatory; verified needs the checked certificate number. */
export function certificationRecordErrors(x: { status: string; evidence_source: string; evidence_note: string; certificate_number?: string | null }): string[] {
  const e: string[] = [];
  if (!["verified", "rejected"].includes(x.status)) e.push("Choose verified or rejected.");
  if (!["certificate_sighted", "issuer_register_checked"].includes(x.evidence_source)) e.push("Choose how the certification was checked.");
  if (x.evidence_note.trim().length < 10) e.push("Describe the evidence checked (at least 10 characters).");
  if (x.status === "verified" && !(x.certificate_number ?? "").trim()) e.push("Enter the certificate number you checked.");
  return e;
}

/** Blockers an office override reason may NOT bypass (mandatory qualification). */
export function mandatoryActivationBlockers(type: PartnerType, data: RecData | InstData, certifications?: Map<string, CertVerification>): string[] {
  if (type !== "installer") return [];
  const emails = ((data as InstData).installers ?? []).map((w) => (w.email ?? "").trim().toLowerCase());
  const verified = emails.filter((e) => certifications?.get(e)?.status === "verified");
  return verified.length ? [] : ["At least one nominated installer needs an office-verified Installer (CII) certification before activation."];
}

export function activationBlockers(type: PartnerType, data: RecData | InstData, agreementVersion: string | null, signedAt: string | null, now = new Date()) {
  const blockers: string[] = [];
  if (!signedAt) blockers.push("The agreement has not been signed.");
  if (type === "rec" ? !ACTIVATABLE_REC_VERSIONS.includes(agreementVersion ?? "") : !ACTIVATABLE_INSTALLER_VERSIONS.includes(agreementVersion ?? "")) blockers.push(`Agreement ${type === "rec" ? REC_AGREEMENT_VERSION : INSTALLER_AGREEMENT_VERSION} must be accepted before activation.`);
  if (!validCalendarDate(data.public_liability_expiry) || (data.public_liability_expiry as string) < melbourneToday(now)) blockers.push("Public liability insurance is expired or missing.");
  return blockers;
}

/** Work preferences that decide whether a business may be offered new Home Insulation Victoria leads. */
export function partnerPreferences(type: PartnerType, raw: RecData | InstData) {
  const d = raw as InstData;
  return {
    accepting_new_jobs: typeof d.accepting_jobs === "boolean" ? d.accepting_jobs : null,
    receives_hivic_leads: type === "installer" ? (typeof d.wants_hivic_leads === "boolean" ? d.wants_hivic_leads : null) : true,
    typical_days: (d.typical_days ?? []).filter((x) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(x)),
    lead_time: d.normal_attendance_speed ?? null,
  };
}

/** Everything the single activation transaction writes, computed purely from the signed application. */
export function planActivation(type: PartnerType, app: { id: string; partner_enquiry_id: string; agreement_version: string | null; agreement_text: string | null; agreement_sha256: string | null; signer_name: string | null; signed_at: string | null; signed_ip: string | null; signed_user_agent: string | null; acknowledgements: unknown; insurance_certificate_path: string | null }, raw: RecData | InstData, certifications: Map<string, CertVerification>, blockers: string[]) {
  const application = (type === "installer" ? normaliseInstallerDraft(raw as InstData) : raw) as RecData & InstData;
  const capability = type === "rec" ? "electrician" : "installer";
  const items = approvedRateItems(type, application);
  return {
    abn: application.abn?.replace(/\D/g, "") || null,
    capability,
    business: {
      name: application.trading_name || application.legal_entity_name || "Partner business",
      legal_name: application.legal_entity_name ?? null, trading_name: application.trading_name ?? null,
      business_type: type === "rec" ? "rec" : "eec_installer",
      email: application.business_email ?? null, phone: application.business_phone ?? null, address: application.business_address ?? null,
      service_regions: [application.service_origin, application.travel_radius_km === 9999 ? "Anywhere in Victoria" : application.travel_radius_km ? `${application.travel_radius_km} km radius` : null].filter((x): x is string => !!x),
      declared_service_origin: application.service_origin ?? null, declared_travel_radius_km: application.travel_radius_km ?? null, declared_excluded_areas: application.excluded_areas ?? null,
      free_measureups_for_hivic_quote_leads: type === "installer" ? application.free_measureups_for_hivic_quote_leads ?? null : null,
      rec_number: type === "rec" ? application.rec_registration_number ?? null : null,
      installer_certification: type === "installer" ? { basis: "per_worker_office_verification", verified_workers: [...certifications.values()].filter((c) => c.status === "verified").map((c) => c.worker_email) } : null,
      gst_registered: application.gst_registered ?? null,
      ...partnerPreferences(type, application),
    },
    workers: activationWorkers(type, application, "00000000-0000-0000-0000-000000000000", app.id, certifications).map(({ business_id: _b, ...w }) => w),
    credential: { kind: "public_liability_insurance", label: "Public liability insurance", number: application.insurance_policy_number ?? null, issuer: application.insurer ?? null, expires_at: application.public_liability_expiry ?? null, critical: true, document_path: app.insurance_certificate_path, verification: "verified" },
    rate_kind: type === "rec" ? "electrical" : "installer",
    card_name: `${application.trading_name || application.legal_entity_name} agreed rates`,
    items,
    agreement: { version: app.agreement_version ?? "unknown", body: app.agreement_text ?? "", signer_name: app.signer_name ?? "Unknown", signed_at: app.signed_at, ip: app.signed_ip, user_agent: app.signed_user_agent, snapshot: { application_id: app.id, acknowledgements: app.acknowledgements }, snapshot_sha256: app.agreement_sha256 ?? "" },
    bank: { account_name: application.bank_account_name, bsb: application.bank_bsb, account_number: application.bank_account_number, supplied_at: app.signed_at },
    bank_event: { source: "signed_onboarding", application_id: app.id, bsb_last3: (application.bank_bsb ?? "").replace(/\D/g, "").slice(-3), account_last3: (application.bank_account_number ?? "").slice(-3) },
    snapshot: { application_id: app.id, agreement_version: app.agreement_version, agreement_sha256: app.agreement_sha256, rates: items, bank_details_supplied: true, blockers },
  };
}

export function approvedRateItems(type: PartnerType, raw: RecData | InstData) {
  const gst = raw.gst_registered === true;
  const ex = (value: number) => Number((gst ? value / 1.1 : value).toFixed(2));
  if (type === "installer") {
    const d = normaliseInstallerDraft(raw as InstData);
    const rows = [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", value: d.r5_rate, r_value: 5, sort: 1 },
      { code: "R6_BATTS", description: "R6.0 ceiling batts supply & install", category: "product", unit: "m2", value: d.r6_rate, r_value: 6, sort: 4, optional: true, positive: true },
      { code: "R7_BATTS", description: "R7.0 ceiling batts supply & install", category: "product", unit: "m2", value: d.r7_rate, r_value: 7, sort: 5, optional: true, positive: true },
      { code: "TOPUP_R5", description: "Top up to R5.0 over existing insulation (existing stays in place)", category: "product", unit: "m2", value: d.topup_r5_rate, r_value: 5, sort: 6, optional: true, positive: true },
      { code: "VACUUM_ONLY", description: "Dust / vermin vacuum only (no insulation removed)", category: "product", unit: "m2", value: d.vacuum_only_rate, r_value: null, sort: 7, optional: true, positive: true },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", value: d.batts_removal_rate, r_value: null, sort: 2 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", value: d.loose_fill_removal_rate, r_value: null, sort: 3 },
      ...EXTRA_ITEMS.map((item, i) => ({ code: item.key.toUpperCase(), description: item.label, category: item.key.includes("access") ? "access" : "travel", unit: "flat", value: d.extra_rates?.[item.key], r_value: null, sort: 10 + i, optional: true })),
    ];
    // Required base/removal rates must be > 0; an OPTIONAL extra keeps an explicit $0 ("no extra charge").
    // A blank extra has no row: it is quoted separately on the job (see installerExtraPricing).
    return rows
      .filter((r): r is typeof r & { value: number } => typeof r.value === "number" && Number.isFinite(r.value) && ("optional" in r && r.optional && !("positive" in r) ? r.value >= 0 : r.value > 0))
      .map(({ value, ...r }) => { const { optional: _o, positive: _p, ...rest } = r as typeof r & { optional?: boolean; positive?: boolean }; return { ...rest, unit_price_ex_gst: ex(value) }; });
  }
  const d = raw as RecData;
  const rows = [
    { code: "PIESA", description: "Pre-insulation Pre Insulation Electrical Safety Assessment (PIESA)", category: "electrical", unit: "flat", value: d.assessment_rate, r_value: null, sort: 1 },
    { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", value: d.installation_attendance_rate, r_value: null, sort: 2 },
    ...RECT_ITEMS.map((item, i) => ({ code: item.rateCode, description: item.label, category: "electrical", unit: "each", display_unit: item.unit, value: d.rectification_rates?.[item.key], r_value: null, sort: 10 + i })),
    ...(d.custom_rectification_rates ?? []).map((item, i) => ({ code: customRateCode(item.id), description: item.description.trim(), category: "electrical", unit: "each", display_unit: item.unit.trim(), value: item.price, r_value: null, sort: 30 + i })),
    { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", value: d.coes_fee_choice === "separate" ? d.coes_fee : null, r_value: null, sort: 20 },
  ];
  return rows.filter((r): r is typeof r & { value: number } => typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0).map(({ value, ...r }) => ({ ...r, unit_price_ex_gst: ex(value) }));
}
/** How an approved installer card prices an optional extra: rated, included at $0, or quoted separately (no row). */
export function installerExtraPricing(items: { code: string; unit_price_ex_gst: number | string }[], key: (typeof EXTRA_ITEMS)[number]["key"]):
  { kind: "rated"; unit_price_ex_gst: number } | { kind: "no_extra_charge"; unit_price_ex_gst: 0 } | { kind: "quoted_separately" } {
  const row = items.find((i) => i.code === key.toUpperCase());
  if (!row) return { kind: "quoted_separately" };
  const p = Number(row.unit_price_ex_gst);
  if (!Number.isFinite(p) || p < 0) return { kind: "quoted_separately" };
  return p === 0 ? { kind: "no_extra_charge", unit_price_ex_gst: 0 } : { kind: "rated", unit_price_ex_gst: p };
}
