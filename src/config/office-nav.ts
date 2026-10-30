// Office navigation (decision 218, approved mock-ups O1–O7; Emails added by Jo 27 Oct 2026, decision 414): top bar Needs me · Enquiries · Emails · Jobs · Partners · Money,
// the rest under More (Communications · Templates · Settings · Test Centre · Sign out); phone bottom tabs mirror the
// six headings. Presentation only: every legacy route still resolves (it redirects or stays a detail view), so
// bookmarks and internal links keep working. Owned by office build A; Partners/Money/Communications/Settings pages are build B's
// (/admin/workers redirects to /admin/partners?tab=people).
import type { LinkProps } from "@tanstack/react-router";

export type OfficeSection = "needs" | "enquiries" | "emails" | "jobs" | "partners" | "money" | "more";
export type OfficeTab = {
  label: string;
  to: NonNullable<LinkProps["to"]>;
  search?: Record<string, string>;
};

/** The home: Needs me (decision 218 "Needs me is the home grouped by office action"). */
export const OFFICE_HOME = "/admin/needs-me" as const;

/** The six primary destinations. Nothing else belongs in the top bar. */
export const OFFICE_HEADINGS: (OfficeTab & { key: Exclude<OfficeSection, "more"> })[] = [
  { key: "needs", label: "Needs me", to: "/admin/needs-me" },
  { key: "enquiries", label: "Enquiries", to: "/admin/enquiries" },
  { key: "emails", label: "Emails", to: "/admin/emails" },
  { key: "jobs", label: "Jobs", to: "/admin/jobs/ours" },
  { key: "partners", label: "Partners", to: "/admin/partners" },
  { key: "money", label: "Money", to: "/admin/money" },
];

const NEEDS_PATHS = ["/admin/needs-me", "/admin/today", "/admin/todo"];
const ENQUIRY_PATHS = ["/admin/enquiries", "/admin/enquiry-groups", "/admin/ready-check", "/admin/hot-leads"];
const EMAIL_PATHS = ["/admin/emails", "/admin/ai-answers"];
const JOB_PATHS = ["/admin/board", "/admin/ap-queue", "/admin/list", "/admin/pipeline", "/admin/quotes", "/admin/operations", "/admin/operations-preview"];
const PARTNER_PATHS = ["/admin/partners", "/admin/businesses", "/admin/workers", "/admin/coverage", "/admin/partners-overview", "/admin/team-ups", "/admin/electrician-rates"];
const MONEY_PATHS = ["/admin/money", "/admin/pricing", "/admin/veec"];

/** Which primary heading (if any) a page belongs to. */
export function sectionFor(pathname: string, search: Record<string, unknown> = {}): OfficeSection {
  const p = pathname.replace(/\/$/, "") || "/";
  void search;
  if (p === "/admin") return "needs";
  if (NEEDS_PATHS.includes(p)) return "needs";
  if (p === "/admin/jobs" || p.startsWith("/admin/jobs/") || JOB_PATHS.includes(p)) return "jobs";
  if (ENQUIRY_PATHS.includes(p)) return "enquiries";
  if (EMAIL_PATHS.includes(p)) return "emails";
  if (PARTNER_PATHS.includes(p) || p.startsWith("/admin/partners/")) return "partners";
  if (MONEY_PATHS.includes(p) || p.startsWith("/admin/money/")) return "money";
  return "more";
}

/** True when the page is part of the Enquiries workspace (used for deep-link defaults). */
export function isEnquiryPage(pathname: string): boolean {
  return ENQUIRY_PATHS.includes(pathname.replace(/\/$/, ""));
}

export function tabActive(t: OfficeTab, pathname: string, search: Record<string, unknown>): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  if (t.to !== p) return false;
  const want = t.search ?? {};
  const keys = new Set([...Object.keys(want), ...Object.keys(search).filter((k) => k === "tab")]);
  for (const k of keys) if ((want[k] ?? undefined) !== (search[k] ?? undefined)) return false;
  return true;
}

/** More (decision 218): Communications · Templates · Settings · Test Centre (+ Sign out under the initials). */
export const MORE_SECTIONS: { label: string; tabs: OfficeTab[] }[] = [
  {
    label: "More",
    tabs: [
      { label: "Communications", to: "/admin/communications" },
      { label: "Templates", to: "/admin/templates" },
      { label: "Settings", to: "/admin/settings" },
      { label: "Test Centre", to: "/admin/test-centre" },
    ],
  },
];

/** Kept for older imports: everything reachable that is not a heading is listed under More. */
export const OFFICE_TOOLS: OfficeTab[] = MORE_SECTIONS.flatMap((s) => s.tabs);

/** Office-facing enquiry outcomes. One label per enquiry — never several competing badges. */
export const OFFICE_ENQUIRY_LABEL: Record<
  "spot_saved" | "offered_spot" | "insulation_requested" | "ineligible" | "needs_attention",
  string
> = {
  spot_saved: "Spot saved",
  offered_spot: "Spot offered",
  insulation_requested: "Asked the 3 questions",
  ineligible: "Ineligible",
  needs_attention: "Estimate goes out automatically",
};
