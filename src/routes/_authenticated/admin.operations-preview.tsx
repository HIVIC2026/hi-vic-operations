import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { operationsOptions as options } from "@/lib/operations-query";
import { OperationsPreviewView } from "@/components/portal/OperationsPreview";
import { Btn } from "@/components/portal/kit";

export const Route = createFileRoute("/_authenticated/admin/operations-preview")({
  loader: ({ context }) => context.queryClient.ensureQueryData(options),
  head: () => ({ meta: [
    { title: "Operations preview — Home Insulation Victoria" },
    { name: "description", content: "Read-only office overview of leads, active work, closed outcomes and recorded waiting parties." },
    { property: "og:title", content: "Operations preview — Home Insulation Victoria" },
    { property: "og:description", content: "Isolated office overview of existing operational records and automation permissions." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: PreviewPage,
  pendingComponent: () => <div role="status" className="portal-theme p-7 text-ink">Loading operations records…</div>,
  errorComponent: PreviewError,
  notFoundComponent: () => <main className="portal-theme p-7 text-ink">Operations preview unavailable.</main>,
});
function PreviewError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <main className="portal-theme min-h-screen bg-canvas p-7 text-ink"><h1 className="font-display text-2xl font-bold">Operations records could not load</h1><p role="alert" className="my-4 text-rose">{error instanceof Error ? error.message : "Read failed"}</p><p className="mb-4 text-sm text-sub">Counts are unavailable. No records were changed.</p><Btn tone="secondary" onClick={() => void router.invalidate()}>Try again</Btn></main>;
}
function PreviewPage() {
  const query = useSuspenseQuery(options);
  return <OperationsPreviewView data={query.data} refreshing={query.isFetching} refresh={() => { void query.refetch(); }} {...(query.error ? { readError: query.error.message } : {})} />;
}