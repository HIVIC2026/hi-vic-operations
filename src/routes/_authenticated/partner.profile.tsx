import { createFileRoute, redirect } from "@tanstack/react-router";

// The old long partner profile form is retired for partners (Jo, 7 Oct): My business has one clean page per section.
export const Route = createFileRoute("/_authenticated/partner/profile")({
  beforeLoad: () => { throw redirect({ to: "/field/business", replace: true }); },
});
