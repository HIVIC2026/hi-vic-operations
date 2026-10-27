import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { partnerLegacyTarget } from "@/lib/legacy-links.core";

// Retired partner addresses (Jo, 7 Oct) land on the trade pages that replaced them; see legacy-links.core.ts.
// The partner layout's role check still runs first on the old address, exactly as before.
export const Route = createFileRoute("/_authenticated/partner/$")({
  beforeLoad: ({ params, search }) => {
    const target = partnerLegacyTarget(params._splat, search as Record<string, unknown>);
    if (!target) throw notFound();
    throw redirect({ ...target, replace: true } as never);
  },
  component: () => null,
});
