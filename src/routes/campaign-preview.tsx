import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired sample page for the old campaign copy test (removed 21 Oct, Jo).
export const Route = createFileRoute("/campaign-preview")({
  beforeLoad: () => { throw redirect({ to: "/", replace: true }); },
  component: () => null,
});
