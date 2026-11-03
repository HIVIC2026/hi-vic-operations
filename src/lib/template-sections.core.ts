// The Templates page sections and its address (search) parser. Kept apart from template-hub.core (which imports every
// template) so the route's validateSearch, which loads with the app, does not pull every template into the first load.
export type TemplateSection = "owner" | "installer" | "electrician" | "office" | "mitti" | "compliance" | "invoices" | "waiting";
export const TEMPLATE_SECTIONS: { key: TemplateSection; label: string; hint: string }[] = [
  { key: "owner", label: "Owner", hint: "Emails, texts, My job pages and paperwork the homeowner gets" },
  { key: "installer", label: "Installer", hint: "Emails and texts to installer businesses and their crews" },
  { key: "electrician", label: "Electrician", hint: "Emails and texts to electricians" },
  { key: "office", label: "Office", hint: "What the office itself sends or reviews" },
  { key: "mitti", label: "Mitti forms", hint: "The five Mitti forms A1–A5, questions as the portal reads them" },
  { key: "compliance", label: "VEU / compliance", hint: "Official forms and documents the owner, installer or ESC receives" },
  { key: "invoices", label: "Invoices", hint: "The final invoice email and the Xero invoice layout" },
  { key: "waiting", label: "Waiting for Jo's approval", hint: "Drafts that send nothing until Jo approves the wording" },
];

export function parseTemplateSearch(s: Record<string, unknown>): { cat: TemplateSection; t?: string } {
  const cat = TEMPLATE_SECTIONS.some((c) => c.key === s["cat"]) ? (s["cat"] as TemplateSection) : "owner";
  const t = typeof s["t"] === "string" && s["t"].length < 80 ? s["t"] : undefined;
  return { cat, ...(t ? { t } : {}) };
}
