// The Home Insulation Victoria office phone shown to owners and trades — env HIV_OFFICE_PHONE only; null = no number on
// file (each message then words its line without a number). One reader so every message agrees. No imports.
export const officePhone = (): string | null => process.env["HIV_OFFICE_PHONE"]?.trim() || null;
