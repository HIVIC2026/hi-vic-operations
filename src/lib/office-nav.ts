// Office navigation (Jo, 7 Oct): exactly four headings — Needs me · Jobs · Partners · Money.
// jobs.stage is the only status; eligibility is a filter on the Jobs board, never a menu item.
// Old pages keep their URLs; retired list pages redirect to the Jobs board.

export type OfficeSection = "needs" | "jobs" | "partners" | "money" | "settings";
import type { LinkProps } from "@tanstack/react-router";
export type OfficeTab = { label: string; to: NonNullable<LinkProps["to"]>; search?: Record<string, string> };

/** Campaign/list pages that aren't job stages: reachable from the avatar menu, not the top bar. */
export const CAMPAIGN_LINKS: OfficeTab[] = [
  { label: "Spot saved campaign", to: "/admin/launch-campaign" },
  { label: "Hot leads", to: "/admin/hot-leads" },
  { label: "Campaign emails", to: "/admin/campaign-emails" },
  { label: "Email groups", to: "/admin/enquiry-groups" },
  { label: "Calculator interest", to: "/admin/interests" },
];

export const SECTION_TABS: Record<OfficeSection, OfficeTab[]> = {
  needs: [],
  jobs: [],
  partners: [
    { label: "Overview", to: "/admin/partners-overview" },
    { label: "Approved", to: "/admin/businesses" },
    { label: "Applications", to: "/admin/partners" },
    { label: "Staff", to: "/admin/workers" },
    { label: "Coverage", to: "/admin/coverage" },
    { label: "Team-ups", to: "/admin/team-ups" },
  ],
  money: [
    { label: "Overview", to: "/admin/money" },
    { label: "Payouts", to: "/admin/money", search: { tab: "payouts" } },
    { label: "AP sign-off", to: "/admin/ap-queue" },
    { label: "Prices", to: "/admin/pricing" },
    { label: "Electrician rates", to: "/admin/electrician-rates" },
    { label: "VEECs", to: "/admin/veec" },
  ],
  settings: [
    { label: "Users", to: "/admin/users" },
    { label: "Compliance", to: "/admin/compliance" },
    { label: "Owner paperwork", to: "/admin/owner-paperwork" },
    { label: "Communications", to: "/admin/communications" },
    { label: "Test centre", to: "/admin/test-centre" },
  ],
};

/** Which heading a page belongs to. */
export function sectionFor(pathname: string, _search: Record<string, unknown> = {}): OfficeSection {
  const p = pathname.replace(/\/$/, "") || "/";
  if (["/admin/needs-me", "/admin/today", "/admin/todo"].includes(p)) return "needs";
  if (SECTION_TABS.partners.some((t) => t.to === p)) return "partners";
  if (SECTION_TABS.money.some((t) => t.to === p)) return "money";
  if (SECTION_TABS.settings.some((t) => t.to === p)) return "settings";
  return "jobs";
}

/** Where a retired office list address now goes (old links and bookmarks). */
export function retiredOfficeRedirect(pathname: string, search: Record<string, unknown>): { to: "/admin/jobs"; search: Record<string, string> } | null {
  const p = pathname.replace(/\/$/, "");
  if (p === "/admin/pipeline") return { to: "/admin/jobs", search: {} };
  if (p === "/admin") {
    const tab = search["tab"];
    if (tab === "quotes") return null; // quote approvals page stays (linked from Needs me)
    if (tab === "enquiries") return { to: "/admin/jobs", search: { elig: "likely" } };
    if (tab === "ineligible") return { to: "/admin/jobs", search: { elig: "not" } };
    return { to: "/admin/jobs", search: {} };
  }
  return null;
}

export function tabActive(t: OfficeTab, pathname: string, search: Record<string, unknown>): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  if (t.to !== p) return false;
  const want = t.search ?? {};
  const keys = new Set([...Object.keys(want), ...Object.keys(search).filter((k) => k === "tab" || k === "status")]);
  for (const k of keys) if ((want[k] ?? undefined) !== (search[k] ?? undefined)) return false;
  return true;
}
