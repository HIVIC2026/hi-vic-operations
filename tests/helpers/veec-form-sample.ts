import type { FieldValue } from "../../src/lib/assignment.core";
import type { VeecSignatures } from "../../src/lib/veec-form-pdf.server";
import { signaturePng } from "./sample-signature-png";

export const SIGNATURE_PNG = signaturePng();
export const SAMPLE_VALUES: Record<string, FieldValue> = {
  ap_full_name: "Chris Lowe", ap_company_name: "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria", ap_company_address: "1/33 Altree Court, Phillip ACT 2606", ap_phone: "0416 252 406",
  elec_full_name: "Will Casdorff", elec_phone: "0400 111 222", elec_licence: "A 12345", elec_company_name: "Viking Electrical", elec_company_address: "10 Sample Rd, Mitcham VIC 3132", elec_rec_number: "REC 12345", ces_issued: "No",
  installer_1_name: "John Smith", installer_1_company: "Rapid Insulation", installer_1_phone: "0400 333 444", installer_1_eec: "CII-0001",
  installation_address: "12 Example St, Box Hill VIC 3128", date_completed: "2026-11-13",
  area_1_name: "Main house", area_1_existing_type: "Uninsulated", area_1_product_type: "48A: Bulk insulation batt or blanket product", area_1_product_brand: "Bradford", area_1_product_model: "Gold Hi-Performance Ceiling Batts", area_1_product_r_value: "R5.0", area_1_area_m2: 137,
  price_before_incentive: 3798, consumer_payment_after: 2188, benefit_form: "Price reduction", benefit_amount: 1610,
  consumer_full_name: "Sarah Brown", consumer_phone: "0400 000 000", consumer_email: "sarah@example.com",
};
export const SAMPLE_SIGS: VeecSignatures = {
  installer: { name: "John Smith", at: "2026-11-13T05:00:00Z" },
  ap: { name: "Chris Lowe", at: "2026-11-14T03:00:00Z" },
  consumer: { name: "Sarah Brown", at: "2026-11-13T07:00:00Z" },
};

