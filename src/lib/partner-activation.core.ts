import { INSTALLER_AGREEMENT_VERSION, type InstData, EXTRA_ITEMS } from "./installer-onboarding.core";
import { REC_AGREEMENT_VERSION, type RecData, RECT_ITEMS, effectiveElectricians, melbourneToday } from "./rec-onboarding.core";

export type PartnerType = "rec" | "installer";

export function activationWorkers(type: PartnerType, application: RecData | InstData, businessId: string, applicationId: string) {
  if (type === "rec") return effectiveElectricians(application as RecData).map((worker) => ({
    business_id: businessId, trade_role: "electrician" as const,
    full_legal_name: worker.full_legal_name?.trim() ?? "", email: worker.email?.trim().toLowerCase() ?? "",
    mobile: worker.mobile?.trim() || null, licence_number: worker.licence_number?.trim() || null,
    qualification: null, source_application_id: applicationId,
  }));
  return ((application as InstData).installers ?? []).map((worker) => ({
    business_id: businessId, trade_role: "installer" as const,
    full_legal_name: worker.full_legal_name?.trim() ?? "", email: worker.email?.trim().toLowerCase() ?? "",
    mobile: worker.mobile?.trim() || null, licence_number: null,
    qualification: worker.qualification?.trim() || null, source_application_id: applicationId,
  }));
}

export function activationBlockers(type: PartnerType, data: RecData | InstData, agreementVersion: string | null, signedAt: string | null, now = new Date()) {
  const expected = type === "rec" ? REC_AGREEMENT_VERSION : INSTALLER_AGREEMENT_VERSION;
  const blockers: string[] = [];
  if (!signedAt) blockers.push("The agreement has not been signed.");
  if (agreementVersion !== expected) blockers.push(`Agreement ${expected} must be accepted before activation.`);
  if (!data.public_liability_expiry || data.public_liability_expiry < melbourneToday(now)) blockers.push("Public liability insurance is expired or missing.");
  return blockers;
}

export function approvedRateItems(type: PartnerType, raw: RecData | InstData) {
  const gst = raw.gst_registered === true;
  const ex = (value: number) => Number((gst ? value / 1.1 : value).toFixed(2));
  if (type === "installer") {
    const d = raw as InstData;
    const rows = [
      { code: "R5_BATTS", description: "R5.0 ceiling batts supply & install", category: "product", unit: "m2", value: d.r5_rate, r_value: 5, sort: 1 },
      { code: "BATTS_REMOVAL", description: "Batts removal and disposal", category: "removal", unit: "m2", value: d.batts_removal_rate, r_value: null, sort: 2 },
      { code: "LOOSE_FILL_REMOVAL", description: "Loose-fill removal and disposal", category: "removal", unit: "m2", value: d.loose_fill_removal_rate, r_value: null, sort: 3 },
      ...EXTRA_ITEMS.map((item, i) => ({ code: item.key.toUpperCase(), description: item.label, category: item.key.includes("access") ? "access" : "travel", unit: "flat", value: d.extra_rates?.[item.key], r_value: null, sort: 10 + i })),
    ];
    return rows.filter((r): r is typeof r & { value: number } => typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0).map(({ value, ...r }) => ({ ...r, unit_price_ex_gst: ex(value) }));
  }
  const d = raw as RecData;
  const rows = [
    { code: "PIESA", description: "Pre-insulation electrical safety assessment (PIESA)", category: "electrical", unit: "flat", value: d.assessment_rate, r_value: null, sort: 1 },
    { code: "INSTALL_ATTENDANCE", description: "Installation-day electrical attendance", category: "electrical", unit: "flat", value: d.installation_attendance_rate, r_value: null, sort: 2 },
    ...RECT_ITEMS.map((item, i) => ({ code: item.key.toUpperCase(), description: item.label, category: "electrical", unit: item.unit === "metre" ? "m2" : "each", value: d.rectification_rates?.[item.key], r_value: null, sort: 10 + i })),
    { code: "COES", description: "Certificate of Electrical Safety", category: "electrical", unit: "flat", value: d.coes_fee_choice === "separate" ? d.coes_fee : null, r_value: null, sort: 20 },
  ];
  return rows.filter((r): r is typeof r & { value: number } => typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0).map(({ value, ...r }) => ({ ...r, unit_price_ex_gst: ex(value) }));
}