// Retired page addresses (Jo, 27 Oct 2026: "Why do all these old things come up"). Each retired page used to be its own
// route file that only redirected, so Lovable's page picker listed every one of them. They now live here as one table,
// served by a catch-all route per area (admin.$.tsx, partner.$.tsx, $.tsx), so old bookmarks and emailed links still land
// on today's page. Pure: no router imports, so the table is unit-tested directly.

export type LegacyTarget = { to: string; search?: Record<string, string> };
type Search = Record<string, unknown>;
type Rule = LegacyTarget | ((search: Search) => LegacyTarget);

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

// Old Leads page statuses: a saved spot is now a job, ineligible/removed live on Jobs › Closed (see admin.enquiries.tsx).
const ENQUIRY_STATUSES = ["all", "new", "spot_saved", "offered_spot", "insulation_requested", "ineligible", "needs_attention", "photos", "removed"];

/** /admin/<slug> → today's office page. */
const OFFICE: Record<string, Rule> = {
  // Jobs (decision 218: the Pipeline board, lists and AP queue are stages on Jobs › Active).
  board: (s) => (s["tab"] === "quotes" ? { to: "/admin/jobs/active", search: { stage: "quote" } } : { to: "/admin/jobs/active" }),
  list: { to: "/admin/jobs/active" },
  pipeline: { to: "/admin/jobs/active" },
  "operations-preview": { to: "/admin/jobs/active" },
  quotes: { to: "/admin/jobs/active", search: { stage: "quote" } },
  // AP approval happens on each job's Final check card (approveApJob); Jobs › Final check lists every job waiting on it.
  "ap-queue": { to: "/admin/jobs/active", search: { stage: "final_check" } },
  operations: (s) => (s["category"] === "active" ? { to: "/admin/jobs/active" } : s["category"] === "closed" ? { to: "/admin/jobs/closed" } : { to: "/admin/enquiries" }),
  // Needs me (the office home).
  today: { to: "/admin/needs-me" },
  todo: { to: "/admin/needs-me" },
  // Enquiries.
  "enquiry-groups": (s) => {
    const status = str(s["status"]) ?? "";
    return { to: "/admin/enquiries", search: { status: ENQUIRY_STATUSES.includes(status) ? status : "all" } };
  },
  "ready-check": { to: "/admin/enquiries" },
  // Partners.
  businesses: { to: "/admin/partners", search: { tab: "approved" } },
  coverage: { to: "/admin/partners", search: { tab: "coverage" } },
  "partners-overview": { to: "/admin/partners" },
  "team-ups": { to: "/admin/partners", search: { tab: "people" } },
  workers: { to: "/admin/partners", search: { tab: "people" } },
  // Money.
  pricing: { to: "/admin/money", search: { tab: "prices" } },
  veec: { to: "/admin/money", search: { tab: "veecs" } },
  // Communications and templates.
  "hot-leads": { to: "/admin/communications" },
  "launch-campaign": { to: "/admin/communications" },
  "campaign-emails": { to: "/admin/templates", search: { cat: "owner" } },
  // Settings.
  compliance: (s) => ({ to: "/admin/settings", search: { tab: "templates", ...(str(s["key"]) ? { key: str(s["key"])! } : {}) } }),
  "owner-paperwork": { to: "/admin/settings", search: { tab: "templates" } },
  deleted: { to: "/admin/settings", search: { tab: "deleted" } },
};

/** /partner/<slug> → the trade pages that replaced the old partner area (Jo, 7 Oct). */
const PARTNER: Record<string, Rule> = {
  add: { to: "/partner/import" },
  "bulk-import": { to: "/partner/import" },
  payments: { to: "/field/money" },
  profile: { to: "/field/business" },
};

/** Public /<slug> pages that were retired. */
const PUBLIC: Record<string, Rule> = {
  "campaign-preview": { to: "/" },
  "installer-preview": { to: "/partner/import" },
  "step3-email-preview": { to: "/admin/templates", search: { cat: "owner" } },
};

export const OFFICE_HOME_FALLBACK: LegacyTarget = { to: "/admin/needs-me" };

function resolve(table: Record<string, Rule>, splat: string | undefined, search: Search): LegacyTarget | null {
  const slug = (splat ?? "").replace(/^\/+|\/+$/g, "");
  if (!Object.prototype.hasOwnProperty.call(table, slug)) return null;
  const rule = table[slug]!;
  return typeof rule === "function" ? rule(search) : rule;
}

export const officeLegacyTarget = (splat: string | undefined, search: Search = {}) => resolve(OFFICE, splat, search);
export const partnerLegacyTarget = (splat: string | undefined, search: Search = {}) => resolve(PARTNER, splat, search);
export const publicLegacyTarget = (splat: string | undefined, search: Search = {}) => resolve(PUBLIC, splat, search);

/** Every retired office path, for the office menu's "which heading is this" lookup and tests. */
export const RETIRED_OFFICE_SLUGS = Object.keys(OFFICE);
