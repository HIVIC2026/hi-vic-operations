import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { JobCard, type JobRow } from "@/components/portal/JobCard";
import { EXCEPTION_STAGES, STAGE_LABEL, STAGE_ORDER, type Stage } from "@/lib/workflow";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAction } from "@/hooks/use-me";
import { createEnquiry } from "@/lib/portal.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Pipeline – HI VIC Portal" }, { name: "description", content: "HI VIC operational job pipeline." }, { property: "og:title", content: "Pipeline – HI VIC Portal" }, { property: "og:description", content: "HI VIC operational job pipeline." }] }),
  component: Pipeline,
});

function Pipeline() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const { data: jobs = [] } = useQuery({
    queryKey: ["pipeline"],
    queryFn: async () => (await supabase.from("job_overview").select("*").order("last_activity_at", { ascending: false })).data ?? [],
  });
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return jobs.filter((j) => !s || [j.job_number, j.property_address, j.owner_name, j.electrician_name, j.installer_name].some((v) => v?.toLowerCase().includes(s)));
  }, [jobs, q]);
  const byStage = (st: Stage) => filtered.filter((j) => j.stage === st);
  const warnings = jobs.filter((j) => j.urgency === "red" || j.urgency === "expired" || j.payment_status === "overdue" || j.payment_status === "xero_sync_error").length;

  return (
    <AppShell wide>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">{jobs.length} jobs · {warnings} need attention</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job, address, person" className="w-64 pl-8" /></div>
          <Button variant="outline" onClick={() => setView(view === "board" ? "list" : "board")}>{view === "board" ? "List view" : "Board view"}</Button>
          <NewEnquiry />
        </div>
      </div>
      {view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {[...STAGE_ORDER, ...EXCEPTION_STAGES].map((st) => (
            <div key={st} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <span>{STAGE_LABEL[st]}</span><span className="rounded bg-muted px-1.5">{byStage(st).length}</span>
              </div>
              <div className="space-y-2">{byStage(st).map((j) => <JobCard key={j.id} job={j} to="/admin/jobs/$jobId" />)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((j: JobRow) => <JobCard key={j.id} job={j} to="/admin/jobs/$jobId" />)}</div>
      )}
    </AppShell>
  );
}

function NewEnquiry() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "", occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", unknown: false, life: false });
  const create = useAction(createEnquiry);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New enquiry</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New enquiry (phone / manual)</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          await create({ full_name: f.full_name, email: f.email, phone: f.phone || null, address_line: f.address_line, suburb: f.suburb || null, postcode: f.postcode || null, occupancy: f.occupancy, estimated_area_m2: f.unknown || !f.area ? null : Number(f.area), area_unknown: f.unknown || !f.area, life_support: f.life }, "Enquiry created");
          setOpen(false);
        }}>
          <div><Label>Name</Label><Input value={f.full_name} onChange={set("full_name")} required /></div>
          <div><Label>Email</Label><Input type="email" value={f.email} onChange={set("email")} required /></div>
          <div><Label>Phone</Label><Input value={f.phone} onChange={set("phone")} /></div>
          <div><Label>Occupancy</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.occupancy} onChange={(e) => setF({ ...f, occupancy: e.target.value as "owner_occupied" | "rental" })}>
              <option value="owner_occupied">Owner-occupied</option><option value="rental">Rental</option>
            </select></div>
          <div className="sm:col-span-2"><Label>Street address</Label><Input value={f.address_line} onChange={set("address_line")} required /></div>
          <div><Label>Suburb</Label><Input value={f.suburb} onChange={set("suburb")} /></div>
          <div><Label>Postcode</Label><Input value={f.postcode} onChange={set("postcode")} /></div>
          <div><Label>Est. ceiling area m²</Label><Input type="number" value={f.area} onChange={set("area")} disabled={f.unknown} /></div>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={f.unknown} onCheckedChange={(v) => setF({ ...f, unknown: !!v })} /> I don't know the area</label>
            <label className="flex items-center gap-2"><Checkbox checked={f.life} onCheckedChange={(v) => setF({ ...f, life: !!v })} /> Life support at property</label>
          </div>
          <Button type="submit" className="sm:col-span-2">Create job</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
