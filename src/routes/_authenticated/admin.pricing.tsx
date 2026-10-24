import { createFileRoute, redirect } from "@tanstack/react-router";

// Prices are Money › Prices (decision 243). The VEEC price is entered only in Money › VEECs.
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/pricing")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/money", search: { tab: "prices" }, replace: true });
  },
  component: () => null,
});
