import { createFileRoute, redirect } from "@tanstack/react-router";

// Task 11 (installer screens, Jo 2 Nov 2026): the guide tab is retired — the Job page's one Next step box
// says what to do next. Old bookmarks and the welcome email's guide link land on My work. (A separate route keeps
// /field/guide from being read as a job id by /field/$jobId.)
export const Route = createFileRoute("/_authenticated/field/guide")({
  beforeLoad: () => { throw redirect({ to: "/field", replace: true }); },
  component: () => null,
});
