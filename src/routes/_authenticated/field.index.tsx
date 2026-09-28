import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { JobCard } from "@/components/portal/JobCard";
import { useAction, useMe } from "@/hooks/use-me";
import { submitInstallerJob } from "@/lib/portal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "My jobs – HI VIC Portal" }, { name: "description", content: "Your assigned HI VIC jobs." }, { property: "og:title", content: "My jobs – HI VIC Portal" }, { property: "og:description", content: "Your assigned HI VIC jobs." }] }),
  component: FieldJobs,
});

function FieldJobs() {
  const { data: me } = useMe();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["fieldjobs", me?.user.id],
    enabled: !!me,
    queryFn: async () => {
      const uid = me!.user.id;
      return (await supabase.from("job_overview").select("*").or(`electrician_id.eq.${uid},installer_id.eq.${uid}`).not("stage", "in", "(complete,cancelled)").order("last_activity_at", { ascending: false })).data ?? [];
    },
  });
  const isInstaller = me?.roles.includes("installer");
  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold">My jobs</h1>
      <p className="mb-4 text-sm text-muted-foreground">Jobs assigned to you. Tap a job to work through it onsite.</p>
      {isInstaller && <SubmitJob />}
      {isLoading ? <p className="text-muted-foreground">Loading…</p> : jobs.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{jobs.map((j) => <JobCard key={j.id} job={j} to="/field/$jobId" />)}</div>
      ) : <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">No jobs assigned right now.</p>}
    </AppShell>
  );
}

function SubmitJob() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const submit = useAction(submitInstallerJob);
  const empty = { full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "", occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", life: false };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="mb-4 h-12 w-full sm:w-auto"><Plus /> Submit a job to HI VIC</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Submit your customer's job</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">HI VIC handles eligibility, Owner Authority, the electrician/PIESA visit, evidence review and VEEC. You stay the installer on this job.</p>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const r = await submit({ full_name: f.full_name, email: f.email, phone: f.phone || null, address_line: f.address_line, suburb: f.suburb || null, postcode: f.postcode || null, occupancy: f.occupancy, estimated_area_m2: f.area ? Number(f.area) : null, area_unknown: !f.area, life_support: f.life }, "Job submitted to HI VIC");
          if (r) { setOpen(false); setF(empty); nav({ to: "/field/$jobId", params: { jobId: r.job_id } }); }
        }}>
          <div><Label>Owner full name</Label><Input className="h-12" value={f.full_name} onChange={set("full_name")} required /></div>
          <div><Label>Owner email</Label><Input className="h-12" type="email" value={f.email} onChange={set("email")} required /></div>
          <div><Label>Owner phone</Label><Input className="h-12" type="tel" value={f.phone} onChange={set("phone")} /></div>
          <div><Label>Street address</Label><Input className="h-12" value={f.address_line} onChange={set("address_line")} required minLength={3} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Suburb</Label><Input className="h-12" value={f.suburb} onChange={set("suburb")} /></div>
            <div><Label>Postcode</Label><Input className="h-12" inputMode="numeric" value={f.postcode} onChange={set("postcode")} /></div>
          </div>
          <div><Label>Occupancy</Label>
            <select className="h-12 w-full rounded-md border bg-background px-2 text-sm" value={f.occupancy} onChange={(e) => setF({ ...f, occupancy: e.target.value as "owner_occupied" | "rental" })}>
              <option value="owner_occupied">Owner-occupied</option><option value="rental">Rental</option>
            </select></div>
          <div><Label>Estimated ceiling area m² (optional)</Label><Input className="h-12" inputMode="decimal" value={f.area} onChange={set("area")} /></div>
          <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.life} onChange={(e) => setF({ ...f, life: e.target.checked })} /> Someone at the property uses life support equipment</label>
          <Button type="submit" className="h-12">Submit to HI VIC</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
