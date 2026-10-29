import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TradeShell } from "@/components/trade/TradeShell";
import { AddJobFlow, PRIMARY_BTN } from "@/components/trade/add-job-flow";
import { addJobStart } from "@/lib/onsite-ready-check.functions";
import { ADD_JOB_DETAIL, ADD_JOB_LEAD, ADD_JOB_STAFF_ONLY } from "@/lib/add-job-flow.core";

export const Route = createFileRoute("/_authenticated/partner/import")({
  head: () => ({ meta: [{ title: "Add a job – Home Insulation Victoria" }, { name: "description", content: "Add your customer's job: name, address, mobile, email and contact permission. The Mitti Ready Check form is created for you." }, { property: "og:title", content: "Add a job – Home Insulation Victoria" }, { property: "og:description", content: "Add your customer's job: name, address, mobile, email and contact permission." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ImportPage,
});

// One Add a job for installer-supplied customers (approved mock-up M3, decision 198): basics only (decision 34), the
// Mitti form made straight away (decision 115) and one optional visit day + time (decision 116). No bulk upload
// (decision 42), no mode chooser.
function ImportPage() {
  const navigate = useNavigate();
  const loadStart = useServerFn(addJobStart);
  const { data: start, isLoading, isError, isFetching, refetch } = useQuery({ queryKey: ["add-job-start", "mine"], queryFn: () => loadStart(), retry: 1, staleTime: 30_000 });
  return (
    <TradeShell installer redesign>
      {/* Approved heavier design (decision 237): 24px title, bold 15px lead, 14px detail. */}
      <div data-add-job-heading>
        <h1 className="font-display text-2xl font-bold leading-[1.2]">Add a job</h1>
        <p className="mt-1.5 text-[15px] font-semibold leading-[1.45]">{ADD_JOB_LEAD}</p>
        <p className="mt-0.5 text-sm leading-[1.45] text-sub">{ADD_JOB_DETAIL}</p>
      </div>
      {isLoading ? <p className="text-sm text-sub">Loading…</p>
        : isError ? <div className="space-y-3"><p className="text-sm" role="alert">Your business details couldn't load. Check your signal and try again.</p><button type="button" className={PRIMARY_BTN} disabled={isFetching} onClick={() => refetch()}>{isFetching ? "Retrying…" : "Retry"}</button></div>
        : start?.kind === "staff" ? <div className="space-y-2 rounded-[12px] bg-mist p-4" data-no-business><p className="text-sm">{ADD_JOB_STAFF_ONLY}</p><Link to="/field" className="block min-h-11 py-2 text-sm font-semibold text-hiv-blue">Back to My work</Link></div>
        : start?.kind !== "owner" ? <div className="space-y-2 rounded-[12px] bg-mist p-4" data-no-business><p className="text-sm">This sign-in isn't linked to an approved installer business, so jobs can't be added here.</p><p className="text-sm text-sub">Contact Home Insulation Victoria if you think this is wrong.</p><Link to="/field" className="block min-h-11 py-2 text-sm font-semibold text-hiv-blue">Back to My work</Link></div>
        : <AddJobFlow businessId={start.businessId} onExit={() => { void navigate({ to: "/field" }); }} />}
    </TradeShell>
  );
}
