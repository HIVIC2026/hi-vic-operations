// Office navigation map: every existing admin page lives under one top-bar heading as a tab.
// Presentation only — routes are unchanged, so old links keep working.

export type OfficeSection = "overview" | "leads" | "active" | "closed" | "partners" | "money" | "templates" | "settings";
import type { LinkProps } from "@tanstack/react-router";
export type OfficeTab = { label: string; to: NonNullable<LinkProps["to"]>; search?: Record<string, string> };

export const ENQUIRY_TABS: OfficeTab[] = [
  { label: "Website email queue", to: "/admin/enquiry-groups" },
  { label: "All classified leads", to: "/admin/operations", search: { category: "leads" } },
  { label: "Calculator interest", to: "/admin/interests" },
  // P1-R1-S93: Office manual Template 8 invitations for saved-spot jobs.
  { label: "Ready Check invitations", to: "/admin/ready-check" },
];

export const SECTION_TABS: Record<OfficeSection, OfficeTab[]> = {
  leads: ENQUIRY_TABS,
  overview: [],
  active: [],
  closed: [],
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
    { label: "Deleted jobs", to: "/admin/deleted" },
  ],
};

const ENQUIRY_PATHS = ["/admin/launch-campaign", "/admin/hot-leads", "/admin/campaign-emails", "/admin/enquiry-groups", "/admin/interests", "/admin/ready-check"];

/** Which heading a page belongs to. */
export function sectionFor(pathname: string, search: Record<string, unknown> = {}): OfficeSection {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/admin/operations") return search["category"] === "active" ? "active" : search["category"] === "closed" ? "closed" : search["category"] === "leads" ? "leads" : "overview";
  if (isEnquiryPage(p, search)) return "leads";
  if (SECTION_TABS.partners.some((t) => t.to === p)) return "partners";
  if (SECTION_TABS.money.some((t) => t.to === p)) return "money";
  if (p === "/admin/templates") return "templates";
  if (SECTION_TABS.settings.some((t) => t.to === p)) return "settings";
  void search;
  return "overview";
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
  const keys = new Set([...Object.keys(want), ...Object.keys(search).filter((k) => k === "tab" || k === "status" || k === "cat" || k === "category")]);
  for (const k of keys) if ((want[k] ?? undefined) !== (search[k] ?? undefined)) return false;
  return true;
}

/** Legacy tools remain precise secondary destinations, never unreliable headline counts. */
export const OFFICE_TOOLS: OfficeTab[] = [
  { label: "Today", to: "/admin/today" },
  { label: "Quote approvals", to: "/admin", search: { tab: "quotes" } },
  { label: "AP review", to: "/admin/ap-queue" },
  { label: "Communications", to: "/admin/communications" },
  { label: "Bulk spot emails", to: "/admin/hot-leads" },
  { label: "Saved-spot campaign", to: "/admin/launch-campaign" },
  { label: "Campaign emails", to: "/admin/campaign-emails" },
  { label: "Video check tool", to: "/admin/list", search: { status: "enquiry.video_in" } },
  { label: "Legacy task list (not reconciled)", to: "/admin/needs-me" },
  { label: "Legacy stage tool", to: "/admin/pipeline" },
  { label: "Legacy board", to: "/admin" },
  { label: "Legacy live-job tool", to: "/admin", search: { tab: "jobs" } },
  { label: "Original operations preview", to: "/admin/operations-preview" },
];
export const OFFICE_HEADINGS: (OfficeTab & { key: OfficeSection })[] = [
  { key: "overview", label: "Overview", to: "/admin/operations" },
  { key: "leads", label: "Leads", to: "/admin/enquiry-groups" },
  { key: "active", label: "Active jobs", to: "/admin/operations", search: { category: "active" } },
  { key: "closed", label: "Closed jobs", to: "/admin/operations", search: { category: "closed" } },
  { key: "partners", label: "Partners", to: "/admin/partners-overview" },
  { key: "templates", label: "Templates", to: "/admin/templates" },
];
