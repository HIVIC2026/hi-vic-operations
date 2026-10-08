import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/portal/AppShell";
import { OperationsPreviewView } from "@/components/portal/OperationsPreview";
import { Button } from "@/components/ui/button";
import { operationsOptions } from "@/lib/operations-query";
import type { OperationsFilter } from "@/lib/operations-filter.core";

export const Route = createFileRoute("/_authenticated/admin/operations")({
  validateSearch: (s: Record<string, unknown>): OperationsFilter => ({
    category: typeof s["category"] === "string" ? s["category"] : "overview",
    process: typeof s["process"] === "string" ? s["process"] : null,
    party: typeof s["party"] === "string" ? s["party"] : null,
    source: typeof s["source"] === "string" ? s["source"] : "all",
    eligibility: typeof s["eligibility"] === "string" ? s["eligibility"] : "all",
    flag: typeof s["flag"] === "string" ? s["flag"] : null,
    q: typeof s["q"] === "string" ? s["q"] : "",
    page: typeof s["page"] === "number" && Number.isFinite(s["page"]) ? Math.max(1, Math.floor(s["page"])) : 1,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(operationsOptions),
  head: () => ({ meta: [
    { title: "Office overview — Home Insulation Victoria" },
    { name: "description", content: "Office leads, active jobs, closed outcomes and current waiting parties from recorded operational facts." },
    { property: "og:title", content: "Office overview — Home Insulation Victoria" },
    { property: "og:description", content: "Reconciled business work and current recorded actions." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: OperationsPage,
  pendingComponent: () => <p role="status" className="portal-theme p-7 text-ink">Loading office records…</p>,
  errorComponent: OperationsError,
  notFoundComponent: () => <p className="portal-theme p-7 text-ink">Office operations unavailable.</p>,
});
function OperationsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <AppShell><h1 className="font-display text-xl font-bold">Office records could not load</h1><p role="alert" className="my-3 text-rose">{error.message}</p><p className="mb-3 text-sm text-sub">Counts are unavailable, not zero.</p><Button variant="outline" onClick={() => void router.invalidate()}>Retry read</Button></AppShell>;
}
function OperationsPage() {
  const query = useSuspenseQuery(operationsOptions);
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  return <AppShell wide><OperationsPreviewView embedded data={query.data} refreshing={query.isFetching} refresh={() => void query.refetch()} {...(query.error ? { readError: query.error.message } : {})} filters={filters} onFiltersChange={next => void navigate({ search: next, resetScroll: false })} /></AppShell>;
}