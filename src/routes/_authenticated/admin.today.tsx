import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired 24 Oct 2026 (decision 218, audit removal 8): Today's brief repeated Needs me, Quotes to check and New from
// installers under other headings. Old links land on Needs me. (The daily brief data used by the allocation tick stays.)
export const Route = createFileRoute("/_authenticated/admin/today")({
  beforeLoad: () => { throw redirect({ to: "/admin/needs-me", replace: true }); },
  component: () => null,
});
