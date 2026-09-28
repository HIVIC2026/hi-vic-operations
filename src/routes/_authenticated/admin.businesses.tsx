import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { BusinessProfile, MeasurementStandardCard } from "@/components/portal/business";
import { useAction } from "@/hooks/use-me";
import { runPartnerExpirySweep, saveBusiness } from "@/lib/pilot.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/businesses")({
  head: () => ({ meta: [{ title: "Partner Businesses – HI VIC Portal" }, { name: "description", content: "Onboard and approve installer and electrician partner businesses." }, { property: "og:title", content: "Partner Businesses – HI VIC Portal" }, { property: "og:description", content: "Onboard and approve installer and electrician partner businesses." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Businesses,
});

function Businesses() {
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"eec_installer" | "rec">("eec_installer");
  const create = useAction(saveBusiness);
  const sweep = useAction(runPartnerExpirySweep);
  const { data: rows = [], refetch } = useQuery({ queryKey: ["businesses-admin"], queryFn: async () => (await supabase.from("businesses").select("id, name, business_type, capabilities, onboarding_status, xero_contact_status, updated_at").order("name")).data ?? [] });
  return (
    <AppShell wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-2xl font-bold">Partner businesses</h1><p className="text-sm text-muted-foreground">Installer and electrician partners. Only approved partners with current documents can take compliance work.</p></div>
        <Button variant="outline" onClick={() => sweep(undefined as never, "Expiry check complete")}>Check expiries</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          <MeasurementStandardCard />
          <div className="rounded-xl border bg-card p-3">
            <Input placeholder="New business name" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="mt-2 flex gap-2"><select className="h-10 flex-1 rounded border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="eec_installer">Installer</option><option value="rec">Electrician / REC</option></select>
              <Button disabled={name.trim().length < 2} onClick={async () => { const r = await create({ name, business_type: type, capabilities: [type === "rec" ? "electrician" : "installer"] }, "Business created"); if (r) { setOpen(r.id); setName(""); refetch(); } }}>Create</Button></div>
          </div>
          {rows.map((r) => (
            <button key={r.id} onClick={() => setOpen(r.id)} className={`block w-full rounded-xl border bg-card p-3 text-left text-sm hover:border-primary ${open === r.id ? "border-primary" : ""}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{r.name}</span><Badge variant="outline" className="capitalize">{r.onboarding_status.replace("_", " ")}</Badge></div>
              <div className="text-xs text-muted-foreground">{r.business_type === "rec" ? "Electrician / REC" : r.business_type === "eec_installer" ? "Installer" : r.business_type}{r.capabilities?.length ? ` · ${r.capabilities.join(" + ")}` : ""}</div>
            </button>
          ))}
        </div>
        <div>{open ? <BusinessProfile key={open} businessId={open} isHivicAdmin /> : <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Choose a business to review.</p>}</div>
      </div>
    </AppShell>
  );
}
