import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  return <AppShell><h1 className="font-display text-xl font-bold">Office records could not load</h1><p role="alert" className="my-3 text-rose">{error instanceof Error ? error.message : "Read failed"}</p><p className="mb-3 text-sm text-sub">Counts are unavailable, not zero.</p><Button variant="outline" onClick={() => void router.invalidate()}>Retry read</Button></AppShell>;
}
function OperationsPage() {
  // Never block the route on this read: it is a whole-business aggregate and can take
  // tens of seconds on a large book. A blocked loader rendered a blank page (P1-R1-DEF-06),
  // which office staff read as a crash. Render the shell and say what is happening instead.
  const query = useQuery(operationsOptions);
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  if (query.error) return <AppShell><h1 className="font-display text-xl font-bold">Office records could not load</h1><p role="alert" className="my-3 text-rose">{query.error instanceof Error ? query.error.message : "Read failed"}</p><p className="mb-3 text-sm text-sub">Counts are unavailable, not zero.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry read</Button></AppShell>;
  if (!query.data) return <AppShell wide><p role="status" className="p-7 text-ink">Reading every job — this can take up to 30 seconds on a large book. Nothing is changed while it loads.</p></AppShell>;
  return <AppShell wide><OperationsPreviewView embedded data={query.data} refreshing={query.isFetching} refresh={() => void query.refetch()} filters={filters} onFiltersChange={next => void navigate({ search: next, resetScroll: false })} /></AppShell>;
}