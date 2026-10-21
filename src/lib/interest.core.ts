/**
 * "Register my interest" capture for the public calculator.
 *
 * Pure rules only: what we accept, how we clean it, and what the estimate covers.
 * Nothing here sends a message, creates a job or writes outside the portal —
 * the office follows up by hand from the Interest list.
 */
import { z } from "zod";
import { CALC_MAX_M2, CALC_MIN_M2 } from "./estimate.core";

export const INTEREST_CONSENT_VERSION = "interest-2026-10-01";
export const INTEREST_CONSENT_STATEMENT =
  "Home Insulation Victoria may contact me about my ceiling insulation using these details.";

export const INTEREST_STATUSES = ["new", "contacted", "booked", "closed"] as const;
export type InterestStatus = (typeof INTEREST_STATUSES)[number];

/**
 * What the price on screen actually covers. Labels are the exact quote lines the
 * owner is later shown, so the calculator and the quote never disagree.
 */
export const INTEREST_INCLUDED = [
  {
    label: "Ready Check — free",
    detail: "$0. We confirm your ceiling size, access and what is needed before anyone is booked — no surprises, no second visits.",
  },
  {
    label: "Mandatory Pre Insulation Electrical Safety Assessment (PIESA)",
    detail: "Carried out by a licensed electrician we have checked and approved, close to installation day.",
  },
  {
    label: "R5.0 ceiling insulation — supply & install",
    detail: "Fitted by an EEC-certified installer we have checked and approved.",
  },
  {
    label: "Home Insulation Victoria — Accredited Person Management",
    detail: "We hold the program compliance, handle the paperwork and claim the rebate.",
  },
] as const;

const rawInterestSchema = z.object({
  fullName: z.string().trim().min(2, "Please enter your name").max(120),
  mobile: z.string().trim().min(6, "Please enter your mobile number").max(20),
  email: z.string().trim().min(3).max(254).email("Please enter a valid email address"),
  addressLine: z.string().trim().max(200),
  suburb: z.string().trim().max(120),
  postcode: z.union([z.literal(""), z.string().trim().regex(/^\d{4}$/, "Please enter the 4-digit postcode")]),
  ceilingM2: z.union([z.literal(0), z.number().int().min(CALC_MIN_M2).max(CALC_MAX_M2)]),
  insulationDeclared: z.enum(["none", "present", "unknown"]),
  consent: z.boolean(),
  honeypot: z.string().max(0),
});

export type InterestDraft = {
  fullName: string;
  mobile: string;
  email: string;
  addressLine: string;
  suburb: string;
  postcode: string;
  ceilingM2: number | null;
  insulationDeclared: "none" | "present" | "unknown";
  consent: boolean;
  honeypot: string;
};

export type NormalisedInterest = {
  fullName: string;
  mobile: string;
  email: string;
  addressLine: string;
  suburb: string;
  postcode: string;
  ceilingM2: number;
  insulationDeclared: "none" | "present" | "unknown";
  consentVersion: string;
};

export type InterestParse =
  | { ok: true; value: NormalisedInterest }
  | { ok: false; errors: Partial<Record<keyof InterestDraft, string>> };

const FIELD_MESSAGES: Partial<Record<z.ZodIssueCode, string>> = {};

/** "john-smith mcdonald" → "John-Smith McDonald": first letter of each word, part and after an apostrophe up. */
export function tidyName(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  const words = collapsed
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
  return words.replace(/(^|[-'’])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** AU mobile → +61 form. Returns null when it cannot be a real number. */
export function tidyMobile(value: string): string | null {
  const trimmed = value.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (plus && digits.startsWith("61")) {
    const rest = digits.slice(2);
    return rest.length >= 8 && rest.length <= 10 ? `+61${rest}` : null;
  }
  if (digits.startsWith("61")) {
    const rest = digits.slice(2);
    return rest.length >= 8 && rest.length <= 10 ? `+61${rest}` : null;
  }
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    return rest.length >= 8 && rest.length <= 10 ? `+61${rest}` : null;
  }
  if (digits.length >= 9 && digits.length <= 10) return `+61${digits}`;
  return null;
}

function messageFor(issue: z.ZodIssue): string {
  if (issue.code === "custom" && issue.message) return issue.message;
  if (issue.code === "invalid_type" && issue.received === "null") return "Please fill this in";
  if (issue.code === "too_small") return issue.message;
  if (issue.code === "too_big") return issue.message;
  if (issue.code === "invalid_string") return issue.message;
  return FIELD_MESSAGES[issue.code] ?? "Please check this answer";
}

/** Validates and cleans a draft. Consent must be ticked; a filled honeypot is silently refused. */
export function parseInterest(input: InterestDraft): InterestParse {
  const parsed = rawInterestSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Partial<Record<keyof InterestDraft, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "") as keyof InterestDraft;
      if (!errors[key]) errors[key] = messageFor(issue);
    }
    // Consent needs a plain, human reason rather than a schema message.
    if (!input.consent) errors.consent = "Please tick the box so we can contact you.";
    return { ok: false, errors };
  }
  if (!parsed.data.consent)
    return { ok: false, errors: { consent: "Please tick the box so we can contact you." } };
  if (parsed.data.honeypot.trim() !== "") return { ok: false, errors: { honeypot: "SPAM_REFUSED" } };
  const mobile = tidyMobile(parsed.data.mobile);
  if (!mobile) return { ok: false, errors: { mobile: "Please enter a valid Australian mobile number." } };
  return {
    ok: true,
    value: {
      fullName: tidyName(parsed.data.fullName),
      mobile,
      email: parsed.data.email.toLowerCase(),
      addressLine: parsed.data.addressLine.replace(/\s+/g, " ").trim(),
      suburb: parsed.data.suburb.replace(/\s+/g, " ").trim(),
      postcode: parsed.data.postcode,
      ceilingM2: parsed.data.ceilingM2,
      insulationDeclared: parsed.data.insulationDeclared,
      consentVersion: INTEREST_CONSENT_VERSION,
    },
  };
}
