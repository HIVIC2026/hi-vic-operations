// Pure: the office Templates hub register (Email / Mitti / Compliance). Presentation only.
// Every entry points at an EXISTING renderer, stored version list or connection component —
// nothing here holds wording, decides approval or changes workflow. Unknown metadata says so.
import { ACTIVITY_48_FORMS, COMPLIANCE_TEMPLATE_KEYS, CUSTOMER_COMMUNICATION_CATALOG, MITTI_FORM_ORDER } from "./template-catalog";
import type { FormKey } from "./mitti-forms.core";
import type { JoTemplateId } from "./jo-email-templates.core";

export type TemplateCategory = "email" | "mitti" | "compliance";
export const TEMPLATE_CATEGORIES: { key: TemplateCategory; label: string }[] = [
  { key: "email", label: "Email" }, { key: "mitti", label: "Mitti" }, { key: "compliance", label: "Compliance" },
];

/** What the detail pane mounts for the selected entry (only the selected one is mounted). */
export type TemplateView =
  | { kind: "sample_email"; sample: "likely" | "savespot" | "savespotNoSize" | "onsite" | "ineligible" | "reminder3" | "coverage" }
  | { kind: "partner_invitation"; templateKey: "rec_invitation" | "installer_invitation" }
  | { kind: "partner_email"; email: "welcome" | "changes" | "decline" }
  | { kind: "plain_email"; email: "partner_login" }
  | { kind: "review_only" }
  | { kind: "open_original"; to: "/admin/campaign-emails"; label: string }
  | { kind: "mitti"; formKey: FormKey }
  | { kind: "compliance_template"; templateKey: string }
  | { kind: "register"; index: number; mitti: FormKey[] }
  | { kind: "owner_paperwork"; gate: "A" | "B" | "C" | "D" }
  | { kind: "jo_sample"; templateId: JoTemplateId };

export type TemplateEntry = {
  id: string; category: TemplateCategory; group: string; title: string;
  purpose: string; audience: string; trigger: string;
  /** Approval exactly as recorded in source; "Not recorded" when nothing records it. Stored versions are shown separately. */
  approval: string;
  /** Stored customer review-version key (customer_communication_templates), when one exists. */
  reviewKey?: string;
  view: TemplateView;
};

const comm = (key: string) => CUSTOMER_COMMUNICATION_CATALOG.find((c) => c[0] === key)!;
const commEntry = (key: string, view: TemplateView, approval: string): TemplateEntry => {
  const c = comm(key);
  return { id: `email:${key}`, category: "email", group: "Customer emails", title: c[1], purpose: c[2], audience: "Homeowner", trigger: `Stage ${c[3]}`, approval, reviewKey: key, view };
};

// Jo Lowe's eight approved homeowner emails (P1-R3-COM-08, 15 Oct 2026). These are the SAME definitions
// the sending workflow selects from (selectJoTemplate / renderJoOutcomeEmail), so Office shows what is sent.
const JO_EMAIL: TemplateEntry[] = ([
  ["eligible_no_insulation_size_unknown", "Eligible — no existing insulation (size unknown)"],
  ["eligible_no_insulation_size_known", "Eligible — no existing insulation (size known)"],
  ["eligible_below_r2_reviewed_size_unknown", "Existing insulation below R2, reviewed (size unknown)"],
  ["eligible_below_r2_reviewed_size_known", "Existing insulation below R2, reviewed (size known)"],
  ["potentially_eligible_unknown_size_unknown", "Potentially eligible — insulation to confirm (size unknown)"],
  ["potentially_eligible_unknown_size_known", "Potentially eligible — insulation to confirm (size known)"],
  ["ineligible", "Ineligible result"],
  ["ready_check_invitation", "Ready Check invitation"],
] as const).map(([id, title]): TemplateEntry => ({
  id: `email:jo:${id}`, category: "email", group: "Jo's approved homeowner emails (15 Oct 2026)", title,
  purpose: "Jo Lowe's approved homeowner email. The preview is rendered by the SAME function every real send uses.",
  audience: "Homeowner", trigger: "Initial-enquiry routing / Office decision", approval: "Approved by Jo Lowe, 15 Oct 2026",
  view: { kind: "jo_sample", templateId: id },
}));

const EMAIL: TemplateEntry[] = [
  ...JO_EMAIL,
  commEntry("likely_estimate", { kind: "sample_email", sample: "likely" }, "Locked as approved (project record, 1 Oct 2026)"),
   { id: "email:save_my_spot", category: "email", group: "Customer emails", title: "Save your spot", purpose: "Provides an estimate and invites the homeowner to save a spot while installer capacity is arranged.", audience: "Homeowner (likely eligible, no insulation, ceiling size entered)", trigger: "Office bulk send from leads after Jo presses Send", approval: "Approved final by Jo Lowe, 7 Oct 2026", view: { kind: "sample_email", sample: "savespot" } },
  { id: "email:save_my_spot_no_size", category: "email", group: "Customer emails", title: "Save your spot — no ceiling size", purpose: "Same email using a clearly stated assumed average of 150 m² plus the usual size-check calculator link.", audience: "Homeowner (eligible, no ceiling size given)", trigger: "Separate template; nothing sends it automatically", approval: "Requested by Jo, 8 Oct 2026 — no stored approval record", view: { kind: "sample_email", sample: "savespotNoSize" } },
  commEntry("onsite_estimate", { kind: "sample_email", sample: "onsite" }, "Not recorded"),
  { id: "email:insulation_details", category: "email", group: "Customer emails", title: "Insulation details (Group B) — superseded copy", purpose: "HISTORICAL ONLY. The live Group B request is Jo's T5/T6 (see \"Jo's approved homeowner emails\"); this entry records the earlier campaign copy and cannot be sent.", audience: "Homeowner (existing or unknown insulation)", trigger: "None — the sender uses T5/T6", approval: "Superseded by Jo's approved T5/T6, 15 Oct 2026", view: { kind: "review_only" } },
  commEntry("ineligible_result", { kind: "sample_email", sample: "ineligible" }, "Not recorded"),
  commEntry("estimate_unopened_3d", { kind: "sample_email", sample: "reminder3" }, "Not recorded"),
  commEntry("area_unavailable", { kind: "sample_email", sample: "coverage" }, "Not recorded"),
  ...(["measured_quote", "booking_consent", "pre_install_pack", "assignment_signing", "completion_pack"] as const).map((k) => commEntry(k, { kind: "review_only" }, "Not recorded")),
  { id: "email:rec_invitation", category: "email", group: "Partner emails", title: "REC partnership invitation", purpose: "Invites licensed electricians to apply.", audience: "Electrician / REC", trigger: "Office sends manually (download or copy)", approval: "Not recorded", view: { kind: "partner_invitation", templateKey: "rec_invitation" } },
  { id: "email:installer_invitation", category: "email", group: "Partner emails", title: "Installer partnership invitation", purpose: "Invites insulation installers to apply.", audience: "Installer", trigger: "Office sends manually (download or copy)", approval: "Approved copy (project record)", view: { kind: "partner_invitation", templateKey: "installer_invitation" } },
  { id: "email:partner_welcome", category: "email", group: "Partner emails", title: "Partner welcome", purpose: "Tells an approved partner to set their password.", audience: "Approved installer / electrician", trigger: "When the office approves an application", approval: "Approved by Jo, 8 Oct 2026", view: { kind: "partner_email", email: "welcome" } },
  { id: "email:partner_changes", category: "email", group: "Partner emails", title: "Application — send back for changes", purpose: "Asks an applicant to fix their application and sign again.", audience: "Applicant", trigger: "Office presses Send back (with typed message)", approval: "Approved by Jo, 8 Oct 2026", view: { kind: "partner_email", email: "changes" } },
  { id: "email:partner_decline", category: "email", group: "Partner emails", title: "Application — decline", purpose: "Tells an applicant they were not approved.", audience: "Applicant", trigger: "Office presses Decline", approval: "Approved by Jo, 8 Oct 2026", view: { kind: "partner_email", email: "decline" } },
  { id: "email:partner_login", category: "email", group: "Partner emails", title: "Partner portal login", purpose: "Plain login link email (24-hour single-use link).", audience: "Approved partner", trigger: "Office sends a login link", approval: "Draft wording — Jo to approve (source note)", view: { kind: "plain_email", email: "partner_login" } },
];

const MITTI: TemplateEntry[] = MITTI_FORM_ORDER.map((o) => ({
  id: `mitti:${o.key}`, category: "mitti" as const, group: "Mitti forms", title: `${o.letter} · ${o.forWho}`, purpose: o.who,
  audience: o.key === "piesa" ? "Licensed electrician" : "Installer", trigger: o.key === "piisa" ? "Install day" : o.key === "piesa" ? "Before installation" : "Free Ready Check visit",
  approval: "Not recorded", view: { kind: "mitti" as const, formKey: o.key },
}));

const REGISTER_FOR_TEMPLATE: Record<string, string> = { esc_consent: "ESC Owner Consent (Reg 23A)", installer_declaration: "Installer Declaration", consumer_declaration: "Final Activity 48 VEEC Assignment" };
const MERGED = new Set(Object.values(REGISTER_FOR_TEMPLATE));
const MITTI_FOR_REGISTER: Record<string, FormKey[]> = {
  "Ready Check (Home Insulation Victoria checklist)": ["ready_check_priced", "ready_check"],
  "Pre-installation electrical safety assessment (PIESA)": ["piesa"],
  "Pre-installation installer safety assessment (PIISA)": ["piisa"],
};

export const registerFor = (templateKey: string) => ACTIVITY_48_FORMS.find((f) => f.name === REGISTER_FOR_TEMPLATE[templateKey]) ?? null;

const COMPLIANCE: TemplateEntry[] = [
  ...COMPLIANCE_TEMPLATE_KEYS.map(([k, label]) => {
    const reg = registerFor(k);
    return { id: `compliance:${k}`, category: "compliance" as const, group: "Versioned wording", title: label, purpose: reg?.purpose ?? "Versioned official wording and optional form fields.", audience: reg?.signer ?? "Not recorded", trigger: reg?.timing ?? "Not recorded", approval: "See stored versions", view: { kind: "compliance_template" as const, templateKey: k } };
  }),
  ...ACTIVITY_48_FORMS.map((f, index) => ({ f, index })).filter(({ f }) => !MERGED.has(f.name)).map(({ f, index }) => ({
    id: `register:${index}`, category: "compliance" as const, group: "Activity 48 form register", title: f.name, purpose: f.purpose, audience: f.signer, trigger: f.timing,
    approval: MITTI_FOR_REGISTER[f.name] ? "Official form — see linked Mitti entry" : "Not recorded", view: { kind: "register" as const, index, mitti: MITTI_FOR_REGISTER[f.name] ?? [] },
  })),
  ...(["A", "B", "C", "D"] as const).map((g) => ({ id: `owner:${g}`, category: "compliance" as const, group: "Owner paperwork", title: `Owner paperwork — Gate ${g}`, purpose: "Documents the owner signs or ticks at this gate.", audience: "Homeowner (some items office)", trigger: `Gate ${g}`, approval: "See each document", view: { kind: "owner_paperwork" as const, gate: g } })),
];

export const TEMPLATE_ENTRIES: TemplateEntry[] = [...EMAIL, ...MITTI, ...COMPLIANCE];

export function entriesFor(cat: TemplateCategory) { return TEMPLATE_ENTRIES.filter((e) => e.category === cat); }

/** Selected entry for a category; an id from another category (or unknown) falls back to the category's first entry. */
export function selectTemplate(cat: TemplateCategory, id: string | undefined): TemplateEntry {
  const list = entriesFor(cat);
  return list.find((e) => e.id === id) ?? list[0]!;
}

export function parseTemplateSearch(s: Record<string, unknown>): { cat: TemplateCategory; t?: string } {
  const cat = TEMPLATE_CATEGORIES.some((c) => c.key === s["cat"]) ? (s["cat"] as TemplateCategory) : "email";
  const t = typeof s["t"] === "string" && s["t"].length < 80 ? s["t"] : undefined;
  return t ? { cat, t } : { cat };
}
