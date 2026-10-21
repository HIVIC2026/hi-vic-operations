// Office navigation map (Phase 1 consolidation).
// ONE primary navigation: Enquiries · Active jobs · Closed jobs · Communications · Templates, plus "More".
// Presentation only: every legacy route still resolves (it redirects or stays as an internal detail view),
// so bookmarks and internal links keep working.
import type { LinkProps } from "@tanstack/react-router";

export type OfficeSection =
  "enquiries" | "active" | "closed" | "communications" | "templates" | "more";
export type OfficeTab = {
  label: string;
  to: NonNullable<LinkProps["to"]>;
  search?: Record<string, string>;
};

/** The five primary destinations. Nothing else belongs in the top bar. */
export const OFFICE_HEADINGS: (OfficeTab & { key: Exclude<OfficeSection, "more"> })[] = [
  { key: "enquiries", label: "Enquiries", to: "/admin/enquiries" },
  { key: "active", label: "Active jobs", to: "/admin/jobs/active" },
  { key: "closed", label: "Closed jobs", to: "/admin/jobs/closed" },
  { key: "communications", label: "Communications", to: "/admin/communications" },
  { key: "templates", label: "Templates", to: "/admin/templates" },
];

const COMMUNICATION_PATHS = [
  "/admin/communications",
  "/admin/hot-leads",
  "/admin/launch-campaign",
  "/admin/campaign-emails",
];
const ENQUIRY_PATHS = [
  "/admin/enquiries",
  "/admin/enquiry-groups",
  "/admin/ready-check",
  "/admin/interests",
  "/admin/needs-me",
  "/admin/today",
];
/** Genuine internal detail views reached from a workspace — never primary navigation. */
const MORE_PATHS = [
  "/admin/board",
  "/admin/operations",
  "/admin/ap-queue",
];

/** Which primary heading (if any) a page belongs to. */
export function sectionFor(pathname: string, search: Record<string, unknown> = {}): OfficeSection {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/admin/jobs/active") return "active";
  if (p === "/admin/jobs/closed") return "closed";
  if (p === "/admin/jobs" || p.startsWith("/admin/jobs/")) return "active";
  if (COMMUNICATION_PATHS.includes(p)) return "communications";
  if (p === "/admin/templates") return "templates";
  if (ENQUIRY_PATHS.includes(p)) return "enquiries";
  if (MORE_PATHS.includes(p)) return "more";
  void search;
  return "more";
}

/** True when the page is part of the Enquiries workspace (used for deep-link defaults). */
export function isEnquiryPage(pathname: string, search: Record<string, unknown> = {}): boolean {
  const p = pathname.replace(/\/$/, "");
  if (p === "/admin") return true;
  return (
    ENQUIRY_PATHS.includes(p) ||
    (p === "/admin/list" && String(search["status"] ?? "").startsWith("enquiry."))
  );
}

export function tabActive(
  t: OfficeTab,
  pathname: string,
  search: Record<string, unknown>,
): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  if (t.to !== p) return false;
  const want = t.search ?? {};
  const keys = new Set([...Object.keys(want), ...Object.keys(search).filter((k) => k === "tab")]);
  for (const k of keys) if ((want[k] ?? undefined) !== (search[k] ?? undefined)) return false;
  return true;
}

/**
 * Everything that used to be a top-level destination but is not a primary workspace.
 * These stay reachable from "More" so no capability is lost.
 */
export const OFFICE_TOOLS: OfficeTab[] = [
  { label: "Today's brief", to: "/admin/today" },
  { label: "Quote approvals", to: "/admin/board", search: { tab: "quotes" } },
  { label: "Final check", to: "/admin/ap-queue" },
  { label: "Ready Check invitations", to: "/admin/ready-check" },
  { label: "Registered interest", to: "/admin/interests" },
  { label: "Deleted jobs", to: "/admin/deleted" },
  { label: "Test centre & system health", to: "/admin/test-centre" },
];

export const MORE_SECTIONS: { label: string; tabs: OfficeTab[] }[] = [
  {
    label: "Partners",
    tabs: [
      { label: "Overview", to: "/admin/partners-overview" },
      { label: "Approved", to: "/admin/businesses" },
      { label: "Applications", to: "/admin/partners" },
      { label: "Staff", to: "/admin/workers" },
      { label: "Coverage", to: "/admin/coverage" },
      { label: "Team-ups", to: "/admin/team-ups" },
    ],
  },
  {
    label: "Money",
    tabs: [
      { label: "Overview", to: "/admin/money" },
      { label: "Payouts", to: "/admin/money", search: { tab: "payouts" } },
      { label: "Prices", to: "/admin/pricing" },
      { label: "Electrician rates", to: "/admin/electrician-rates" },
      { label: "VEECs", to: "/admin/veec" },
    ],
  },
  {
    label: "Settings",
    tabs: [
      { label: "Users", to: "/admin/users" },
      { label: "Compliance", to: "/admin/compliance" },
      { label: "Owner paperwork", to: "/admin/owner-paperwork" },
      { label: "Automatic sending rules", to: "/admin/save-my-spot-rules" },
    ],
  },
];

/** Office-facing enquiry outcomes. One label per enquiry — never several competing badges. */
export const OFFICE_ENQUIRY_LABEL: Record<
  "spot_saved" | "offered_spot" | "insulation_requested" | "ineligible" | "needs_attention",
  string
> = {
  spot_saved: "Spot saved",
  offered_spot: "Spot offered",
  insulation_requested: "Awaiting photos/videos",
  ineligible: "Ineligible",
  needs_attention: "Office review",
};
