import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { INSTALLER_BULK_UPLOAD_ENABLED } from "@/lib/bulk-upload-switch.core";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TradeShell } from "@/components/trade/TradeShell";
import { AddJobFlow } from "@/components/trade/add-job-flow";
import { getPartnerProfile } from "@/lib/pilot.functions";
import { Button } from "@/components/trade/trade-ui";

export const Route = createFileRoute("/_authenticated/partner/import")({
  head: () => ({ meta: [{ title: "Add a Job – Home Insulation Victoria Partner Portal" }, { name: "description", content: "Add your customer's job: name, address, mobile, email and contact permission. The Mitti Ready Check form is created for you." }, { property: "og:title", content: "Add a Job – Home Insulation Victoria Partner Portal" }, { property: "og:description", content: "Add your customer's job: name, address, mobile, email and contact permission." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ImportPage,
});

// One Add a job for installer-supplied customers: basics only (decision 34), the Mitti form made straight away
// (decision 115) and one optional visit day + time (decision 116). No mode chooser.
function ImportPage() {
  const navigate = useNavigate();
  const loadProfile = useServerFn(getPartnerProfile);
  const { data: profile, isLoading, isError, isFetching, refetch } = useQuery({ queryKey: ["partner-profile", "mine"], queryFn: () => loadProfile({ data: {} }), retry: 1 });
  const businessId = (profile?.business as { id?: string } | undefined)?.id;
  return (
    <TradeShell installer>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-[26px] font-bold leading-tight">Add a job</h1>
        {INSTALLER_BULK_UPLOAD_ENABLED && <Link to="/partner/bulk-import" data-bulk-upload-link className="inline-flex h-12 items-center rounded-[10px] border-2 border-estimate-blue px-4 text-sm font-bold text-estimate-blue md:h-[42px]">Upload multiple jobs</Link>}
      </div>
      {isLoading ? <p className="text-sm text-sub">Loading…</p>
        : isError ? <div className="mt-3 space-y-2"><p className="text-sm" role="alert">Your business details couldn't load. Check your signal and try again.</p><Button disabled={isFetching} onClick={() => refetch()}>{isFetching ? "Retrying…" : "Retry"}</Button></div>
        : !businessId ? <div className="mt-3 space-y-2 rounded-[18px] border border-line bg-paper p-4" data-no-business><p className="text-sm">This sign-in isn't linked to an approved installer business, so jobs can't be added here.</p><p className="text-sm text-sub">Contact Home Insulation Victoria if you think this is wrong.</p><Link to="/field" className="text-sm font-bold underline">Back to My work</Link></div>
        : <AddJobFlow businessId={businessId} onExit={() => { void navigate({ to: "/field" }); }} />}
    </TradeShell>
  );
}
