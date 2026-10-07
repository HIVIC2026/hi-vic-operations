import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired duplicate (Jo, 7 Oct): Money is the one place for partner payments. Old links land there.
export const Route = createFileRoute("/_authenticated/partner/payments")({
  beforeLoad: () => { throw redirect({ to: "/field/money", replace: true }); },
});
