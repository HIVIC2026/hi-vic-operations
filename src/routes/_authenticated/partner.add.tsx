import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired (Jo, 7 Oct): the old form priced jobs from rate-card lines. "Add one job" now uses the installer's
// own quoted price, what it includes and the site check — same as bulk upload. Old links land there.
export const Route = createFileRoute("/_authenticated/partner/add")({
  beforeLoad: () => { throw redirect({ to: "/partner/import", replace: true }); },
});
