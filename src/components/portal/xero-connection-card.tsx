// Xero connection and routes (moved from Test Centre to Settings › Xero per the office audit; decisions 176/179/181/182).
// Read-only check through the explicitly selected connector credential; organisation routing stays fail-closed
// (TEST jobs only ever reach the Demo Company, live jobs only Home Insulation Victoria — never "first org").
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { getXeroConnection } from "@/lib/portal.functions";

export function XeroConnectionCard() {
  const load = useServerFn(getXeroConnection);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["xero-connection"], queryFn: () => load() });
  const checkError = error ? (error instanceof Error ? error.message : "The connection check failed.") : data?.error;
  return (
    <div className="mb-5 rounded-md border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-3"><b>Xero connection and routes</b><Button size="sm" variant="outline" disabled={isPending} onClick={() => void refetch()}>Check connection</Button></div>
      {isPending ? <p className="mt-2">Checking available organisations…</p> : checkError
        ? <p role="alert" className="mt-2 text-danger">Connection check failed: {checkError}</p>
        : <p className="mt-2">{!data?.configured ? "Connection credentials are not configured." : data.connected ? "Available organisations were confirmed." : "No connected organisations are available."}</p>}
      {data && <>
        {error && <p className="mt-2 text-muted-foreground">The routing details below are from the last completed check.</p>}
        <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">TEST job route</dt><dd>{data.routing.testOrganisation ?? "No Demo Company route is available."}</dd>
          <dt className="text-muted-foreground">Available real candidates</dt><dd>{data.routing.liveCandidates.length ? data.routing.liveCandidates.join(", ") : "None found in this check."}</dd>
          <dt className="text-muted-foreground">Live job route</dt><dd>{!data.routing.liveCallsEnabled ? "Live calls are switched off." : data.routing.liveOrganisation ?? "No live route is selected."}</dd>
          <dt className="text-muted-foreground">Checked</dt><dd><time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString()}</time></dd>
        </dl>
        {data.routing.liveBlocker && <p className="mt-2 text-muted-foreground">Live route blocker: {data.routing.liveBlocker}</p>}
        {data.orgs.length > 0 && <p className="mt-2 text-muted-foreground">Organisations available on this connection: {data.orgs.map(org => org.name + (org.test ? " (test)" : "")).join(", ")}.</p>}
      </>}
    </div>
  );
}
