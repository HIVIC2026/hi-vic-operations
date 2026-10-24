import { createFileRoute, redirect } from "@tanstack/react-router";

// VEECs are Money › VEECs: lodgements and the one VEEC spot-price entry (decision 243).
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/veec")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/money", search: { tab: "veecs" }, replace: true });
  },
  component: () => null,
});
