import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired (Jo, 25 Oct): the old 4-step intake preview ("Who organises?") no longer matches the process. The one-screen
// Add a job (/partner/import, mock-up M3) is the only intake. Old links land there.
export const Route = createFileRoute("/installer-preview")({
  beforeLoad: () => { throw redirect({ to: "/partner/import", replace: true }); },
});
