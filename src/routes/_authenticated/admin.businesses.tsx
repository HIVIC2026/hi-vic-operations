import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { BusinessProfile, MeasurementStandardCard } from "@/components/portal/business";
import { useAction } from "@/hooks/use-me";
import { runPartnerExpirySweep, saveBusiness } from "@/lib/pilot.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useServerFn } from "@tanstack/react-start";
import { getAdminBusinesses } from "@/lib/admin-records.functions";

export const Route = createFileRoute("/_authenticated/admin/businesses")({
  head: () => ({ meta: [{ title: "Partner Businesses – Home Insulation Victoria Portal" }, { name: "description", content: "Onboard and approve installer and electrician partner businesses." }, { property: "og:title", content: "Partner Businesses – Home Insulation Victoria Portal" }, { property: "og:description", content: "Onboard and approve installer and electrician partner businesses." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Businesses,
});

function Businesses() {
  const [open, setOpen] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"eec_installer" | "rec">("eec_installer");
  const create = useAction(saveBusiness);
  const sweep = useAction(runPartnerExpirySweep);
  const load = useServerFn(getAdminBusinesses);
  const { data: rows = [], error, isPending, refetch } = useQuery({ queryKey: ["businesses-admin"], queryFn: () => load(), retry: 3, staleTime: 30_000 });
  const visibleRows = rows.filter((row) => showInactive || !["suspended", "expired"].includes(row.onboarding_status));
  const inactiveCount = rows.length - visibleRows.length;
  return (
    <AppShell wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-2xl font-bold">Partner businesses</h1><p className="text-sm text-muted-foreground">Installer and electrician partners. Only approved partners with current documents can take compliance work.</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setShowInactive((value) => !value)}>{showInactive ? "Hide inactive" : `Inactive history (${inactiveCount})`}</Button><Button variant="outline" onClick={() => sweep(undefined as never, "Expiry check complete")}>Check expiries</Button></div>
      </div>
      {error && <div role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">Partner businesses could not be loaded. Existing records are safe. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>}
      {isPending && <p role="status" className="mb-4 rounded-md border bg-card p-5 text-sm text-muted-foreground">Loading partner businesses…</p>}
      {!error && !isPending && <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          <MeasurementStandardCard />
          <div className="rounded-xl border bg-card p-3">
            <Input placeholder="New business name" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="mt-2 flex gap-2"><select className="h-10 flex-1 rounded border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="eec_installer">Installer</option><option value="rec">Electrician / REC</option></select>
              <Button disabled={name.trim().length < 2} onClick={async () => { const r = await create({ name, business_type: type, capabilities: [type === "rec" ? "electrician" : "installer"] }, "Business created"); if (r) { setOpen(r.id); setName(""); refetch(); } }}>Create</Button></div>
          </div>
           {visibleRows.map((r) => (
            <button key={r.id} onClick={() => setOpen(r.id)} className={`block w-full rounded-xl border bg-card p-3 text-left text-sm hover:border-primary ${open === r.id ? "border-primary" : ""}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{r.name}</span><Badge variant="outline" className="capitalize">{r.onboarding_status.replace("_", " ")}</Badge></div>
              <div className="text-xs text-muted-foreground">{r.business_type === "rec" ? "Electrician / REC" : r.business_type === "eec_installer" ? "Installer" : r.business_type}{r.capabilities?.length ? ` · ${r.capabilities.join(" + ")}` : ""}</div>
            </button>
          ))}
        </div>
        <div>{open ? <BusinessProfile key={open} businessId={open} isHivicAdmin /> : <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Choose a business to review.</p>}</div>
      </div>}
    </AppShell>
  );
}
