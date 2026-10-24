import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired 24 Oct 2026: the Office "Ready Check invitation" email (old Template 8) has no approved design and
// conflicts with decisions 49–53 and 77 — owners of our leads wait for the installer's offered times instead
// of booking themselves. Earlier invitations stay in each job's communication history. Old links land on
// Enquiries so bookmarks keep working.
export const Route = createFileRoute("/_authenticated/admin/ready-check")({
  beforeLoad: () => { throw redirect({ to: "/admin/enquiries", replace: true }); },
  component: () => null,
});
