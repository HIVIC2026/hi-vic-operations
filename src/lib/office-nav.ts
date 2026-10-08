// Office navigation map: every existing admin page lives under one top-bar heading as a tab.
// Presentation only — routes are unchanged, so old links keep working.

export type OfficeSection = "needs" | "leads" | "pipeline" | "partners" | "money" | "templates" | "settings";
import type { LinkProps } from "@tanstack/react-router";
export type OfficeTab = { label: string; to: NonNullable<LinkProps["to"]>; search?: Record<string, string> };

export const ENQUIRY_TABS: OfficeTab[] = [
  { label: "All leads", to: "/admin/enquiry-groups" },
  { label: "Needs video check", to: "/admin/list", search: { status: "enquiry.video_in" } },
  { label: "Calculator interest", to: "/admin/interests" },
];

export const SECTION_TABS: Record<OfficeSection, OfficeTab[]> = {
  leads: ENQUIRY_TABS,
  needs: [{ label: "Needs me", to: "/admin/needs-me" }, { label: "Today", to: "/admin/today" }],
  pipeline: [
    { label: "Stages", to: "/admin/pipeline" },
    { label: "Quotes to approve", to: "/admin", search: { tab: "quotes" } },
    { label: "All live jobs", to: "/admin", search: { tab: "jobs" } },
    { label: "AP sign-off", to: "/admin/ap-queue" },
    { label: "Board", to: "/admin" },
  ],
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
    { label: "Prices", to: "/admin/pricing" },
    { label: "Electrician rates", to: "/admin/electrician-rates" },
    { label: "VEECs", to: "/admin/veec" },
  ],
  templates: [
    { label: "Email", to: "/admin/templates", search: { cat: "email" } },
    { label: "Mitti", to: "/admin/templates", search: { cat: "mitti" } },
    { label: "Compliance", to: "/admin/templates", search: { cat: "compliance" } },
  ],
  settings: [
    { label: "Users", to: "/admin/users" },
    { label: "Compliance", to: "/admin/compliance" },
    { label: "Owner paperwork", to: "/admin/owner-paperwork" },
    { label: "Test centre", to: "/admin/test-centre" },
  ],
};

const ENQUIRY_PATHS = ["/admin/launch-campaign", "/admin/hot-leads", "/admin/campaign-emails", "/admin/enquiry-groups", "/admin/interests"];

/** Which heading a page belongs to. */
export function sectionFor(pathname: string, search: Record<string, unknown> = {}): OfficeSection {
  const p = pathname.replace(/\/$/, "") || "/";
  if (["/admin/needs-me", "/admin/today", "/admin/todo"].includes(p)) return "needs";
  if (isEnquiryPage(p, search)) return "leads";
  if (SECTION_TABS.partners.some((t) => t.to === p)) return "partners";
  if (SECTION_TABS.money.some((t) => t.to === p)) return "money";
  if (p === "/admin/templates") return "templates";
  if (SECTION_TABS.settings.some((t) => t.to === p)) return "settings";
  void search;
  return "pipeline";
}

/** True when the page is one of the Enquiries tabs (so the second tab row shows). */
export function isEnquiryPage(pathname: string, search: Record<string, unknown> = {}): boolean {
  const p = pathname.replace(/\/$/, "");
  if (ENQUIRY_PATHS.includes(p)) return true;
  if (p === "/admin") return search["tab"] === "enquiries" || search["tab"] === "ineligible";
  if (p === "/admin/list") return String(search["status"] ?? "").startsWith("enquiry.");
  return false;
}

export function tabActive(t: OfficeTab, pathname: string, search: Record<string, unknown>): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  if (t.to !== p) return false;
  const want = t.search ?? {};
  const keys = new Set([...Object.keys(want), ...Object.keys(search).filter((k) => k === "tab" || k === "status" || k === "cat")]);
  for (const k of keys) if ((want[k] ?? undefined) !== (search[k] ?? undefined)) return false;
  return true;
}
