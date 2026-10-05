// Office navigation map: every existing admin page lives under one top-bar heading as a tab.
// Presentation only — routes are unchanged, so old links keep working.

export type OfficeSection = "needs" | "pipeline" | "partners" | "money" | "settings";
import type { LinkProps } from "@tanstack/react-router";
export type OfficeTab = { label: string; to: NonNullable<LinkProps["to"]>; search?: Record<string, string> };

export const ENQUIRY_TABS: OfficeTab[] = [
  { label: "Spot saved", to: "/admin/launch-campaign" },
  { label: "Likely eligible", to: "/admin", search: { tab: "enquiries" } },
  { label: "Hot leads", to: "/admin/hot-leads" },
  { label: "Campaign emails", to: "/admin/campaign-emails" },
  { label: "Email groups", to: "/admin/enquiry-groups" },
  { label: "Needs video check", to: "/admin/list", search: { status: "enquiry.video_in" } },
  { label: "Calculator interest", to: "/admin/interests" },
  { label: "Not eligible", to: "/admin", search: { tab: "ineligible" } },
];

export const SECTION_TABS: Record<OfficeSection, OfficeTab[]> = {
  needs: [{ label: "Needs me", to: "/admin/needs-me" }, { label: "Today", to: "/admin/today" }, { label: "To action (old list)", to: "/admin/todo" }],
  pipeline: [
    { label: "Stages", to: "/admin/pipeline" },
    { label: "Enquiries", to: "/admin", search: { tab: "enquiries" } },
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
  settings: [
    { label: "Users", to: "/admin/users" },
    { label: "Compliance", to: "/admin/compliance" },
    { label: "Communications", to: "/admin/communications" },
    { label: "Test centre", to: "/admin/test-centre" },
  ],
};

const ENQUIRY_PATHS = ["/admin/launch-campaign", "/admin/hot-leads", "/admin/campaign-emails", "/admin/enquiry-groups", "/admin/interests"];

/** Which heading a page belongs to. */
export function sectionFor(pathname: string, search: Record<string, unknown> = {}): OfficeSection {
  const p = pathname.replace(/\/$/, "") || "/";
  if (["/admin/needs-me", "/admin/today", "/admin/todo"].includes(p)) return "needs";
  if (SECTION_TABS.partners.some((t) => t.to === p)) return "partners";
  if (SECTION_TABS.money.some((t) => t.to === p)) return "money";
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
  const keys = new Set([...Object.keys(want), ...Object.keys(search).filter((k) => k === "tab" || k === "status")]);
  for (const k of keys) if ((want[k] ?? undefined) !== (search[k] ?? undefined)) return false;
  return true;
}
