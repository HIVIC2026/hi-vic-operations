// P0-B: compact, actionable "enquiry response status" strip for the Office dashboard.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEnquiryResponseOverview } from "@/lib/enquiry-response.functions";

export function EnquiryResponseOverview() {
  const load = useServerFn(getEnquiryResponseOverview);
  const { data } = useQuery({ queryKey: ["enquiry-response-overview"], queryFn: () => load(), staleTime: 30_000 });
  if (!data) return null;
  const { counts, awaiting } = data;
  return (
    <section aria-label="Enquiry response status" className="mb-4 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="font-bold">Enquiry responses</span>
        <span>Awaiting <b data-testid="comms-awaiting">{counts.awaiting}</b></span>
        <span>Sent <b>{counts.sent}</b></span>
        <span className={counts.failed > 0 ? "font-semibold text-destructive" : ""}>Failed <b>{counts.failed}</b></span>
        <span>Manual review <b>{counts.manualReview}</b></span>
        <span>No email <b>{counts.noEmail}</b></span>
      </div>
      {awaiting.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-primary">
            Who still needs a response ({awaiting.length}{counts.awaiting > awaiting.length ? ` of ${counts.awaiting}` : ""})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-sm">
            {awaiting.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-t pt-1">
                <span className="font-mono text-xs">{r.jobNumber ?? "—"}</span>
                <span>{r.ownerName ?? "—"}</span>
                <span className="text-muted-foreground">{r.address ?? ""}</span>
                {r.failed && <span className="font-semibold text-destructive">failed</span>}
                {r.manualReview && <span className="font-semibold text-warning">manual review</span>}
                <a href={`/admin/jobs/${r.id}`} className="ml-auto text-primary underline">Open</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
