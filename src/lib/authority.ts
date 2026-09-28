// Client-safe Owner Authority vocabulary + the current authority wording (versioned).
// Changing the wording = bump AUTHORITY_WORDING_VERSION. Accepted authorities keep their own snapshot.

export const AP_LEGAL_ENTITY = "DC Construction Solutions trading as Home Insulation Victoria";
export const AUTHORITY_WORDING_VERSION = "OA-2026.1";

export const AUTHORITY_SCOPE =
  "Victorian Energy Upgrades (VEU) Activity 48 – ceiling insulation: site assessment and measure-up, electrical safety (PIESA) assessment, any required electrical rectification, ceiling insulation installation, evidence collection, and creation and assignment of Victorian Energy Efficiency Certificates (VEECs) to the Accredited Person.";

export function authorityWording(p: { ownerName: string; propertyAddress: string; validityMonths: number }) {
  return [
    `I, ${p.ownerName}, authorise ${AP_LEGAL_ENTITY} (the Accredited Person) and the licensed electricians and installers it engages to act on my behalf at ${p.propertyAddress} for the following purpose:`,
    AUTHORITY_SCOPE,
    "This includes entering the property at agreed times, accessing the ceiling space, taking photographs, videos and measurements as evidence, completing and submitting compliance records, and creating VEECs for the activity. I assign the right to create VEECs for this activity to the Accredited Person.",
    "I confirm that I am 18 years of age or older, and that I am the owner of the property or am otherwise legally authorised to give this authority.",
    `This authority starts when I accept it and remains valid for ${p.validityMonths} months unless I revoke it earlier by contacting HI VIC. Revoking it stops any further work under this authority.`,
    "I understand the information I provide will be used for the VEU program and may be audited by the Essential Services Commission.",
  ].join("\n\n");
}

export type AuthorityStatus = "not_requested" | "sent" | "viewed" | "accepted" | "declined" | "expired" | "revoked";

export const AUTHORITY_LABEL: Record<AuthorityStatus, string> = {
  not_requested: "Authority not requested",
  sent: "Authority sent",
  viewed: "Authority viewed",
  accepted: "Authority valid",
  declined: "Authority declined",
  expired: "Authority expired",
  revoked: "Authority revoked",
};

export const ASSISTANCE_LABEL = {
  none: "None",
  interpreter: "Interpreter",
  support_understanding: "Support understanding and agreeing to contracts",
  both: "Both",
} as const;

export const authorityIsValid = (s: string | null | undefined) => s === "accepted";
