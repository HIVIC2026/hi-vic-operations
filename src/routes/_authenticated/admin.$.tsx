import { createFileRoute, redirect } from "@tanstack/react-router";
import { OFFICE_HOME_FALLBACK, officeLegacyTarget } from "@/lib/legacy-links.core";

// Retired office addresses (old bookmarks, emailed links) land on today's page; see legacy-links.core.ts for the table.
// Anything else under /admin that no page owns goes to the office home rather than a blank page.
export const Route = createFileRoute("/_authenticated/admin/$")({
  beforeLoad: ({ params, search }) => {
    const target = officeLegacyTarget(params._splat, search as Record<string, unknown>) ?? OFFICE_HOME_FALLBACK;
    throw redirect({ ...target, replace: true } as never);
  },
  component: () => null,
});
