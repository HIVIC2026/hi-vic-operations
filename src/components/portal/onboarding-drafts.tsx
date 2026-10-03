import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOnboardingDrafts } from "@/lib/onboarding-drafts.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const when = (s: string) => new Date(s).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
const label = (k: string | null) => (k ? k.replace(/_/g, " ") : "Not started");

export function OnboardingDrafts({ partnerType }: { partnerType: "electrician_rec" | "installer" }) {
  const load = useServerFn(listOnboardingDrafts);
  const { data = [], error, isPending, refetch } = useQuery({ queryKey: ["onboarding_drafts"], queryFn: () => load(), staleTime: 30_000 });
  const type = partnerType === "installer" ? "installer" : "rec";
  const rows = data.filter((r) => (type === "installer" ? r.partner_type === "installer" : r.partner_type !== "installer"));
  if (isPending) return <p role="status" className="rounded-md border bg-card p-5 text-sm text-muted-foreground">Loading unfinished sign-ups…</p>;
  if (error) return <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">Unfinished sign-ups could not be loaded. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>;
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Started the onboarding form but not signed yet. View only — nothing is sent from here.</p>
      {rows.length === 0 ? <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No unfinished sign-ups.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">{r.business || r.contact || "No details entered yet"}</div>
                <div className="flex gap-1">{r.test_mode && <Badge variant="outline">TEST</Badge>}<Badge variant="outline">Unsigned</Badge></div>
              </div>
              {r.contact && r.business && <div className="text-muted-foreground">{r.contact}</div>}
              {(r.phone || r.email) && <div className="truncate text-muted-foreground">{[r.phone, r.email].filter(Boolean).join(" · ")}</div>}
              {r.abn && <div className="text-muted-foreground">ABN {r.abn}</div>}
              <div className="mt-2 space-y-0.5">
                <div>Last page reached: <span className="capitalize">{label(r.step_key)}</span></div>
                <div>Insurance uploaded: {r.insurance_uploaded ? "Yes" : "No"}</div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">Started {when(r.created_at)} · Last saved {when(r.updated_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
