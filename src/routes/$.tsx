import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { publicLegacyTarget } from "@/lib/legacy-links.core";

// Retired public preview pages land on their replacement; see legacy-links.core.ts. Any other unknown address is still
// the normal "page not found".
export const Route = createFileRoute("/$")({
  beforeLoad: ({ params, search }) => {
    const target = publicLegacyTarget(params._splat, search as Record<string, unknown>);
    if (!target) throw notFound();
    throw redirect({ ...target, replace: true } as never);
  },
  component: () => null,
});
