import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bulkJobAction } from "@/lib/bulk.functions";
import { createTestEnquiry, getAdminPipeline } from "@/lib/portal.functions";

export const Route = createFileRoute("/_authenticated/admin/test-centre")({
  head: () => ({ meta: [
    { title: "Test Centre – Home Insulation Victoria Operations" },
    { name: "description", content: "Create and manage isolated launch-test journeys." },
    { property: "og:title", content: "Test Centre – Home Insulation Victoria Operations" },
    { property: "og:description", content: "Create and manage isolated launch-test journeys." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: TestCentre,
});

const INITIAL = {
  full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "",
  occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", life: false,
  property_type: "house" as "house" | "townhouse" | "unit",
  over_five_years: "yes" as "yes" | "no" | "unknown",
  previous_upgrade: "no" as "yes" | "no" | "unknown",
  existing_insulation: "unknown" as "none" | "some" | "unknown",
};

function TestCentre() {
  const load = useServerFn(getAdminPipeline);
  const remove = useServerFn(bulkJobAction);
  const { data = [], error, isPending, refetch } = useQuery({ queryKey: ["pipeline"], queryFn: () => load(), retry: 3 });
  const jobs = data.filter((job) => job.source === "qa_test");
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <AppShell wide>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
        <div><p className="text-xs font-bold uppercase text-primary">Launch testing</p><h1 className="mt-1 font-display text-3xl font-bold">Test Centre</h1><p className="mt-1 text-sm text-muted-foreground">Dummy journeys stay marked as test records and do not enter live intake automation.</p></div>
        <CreateTestJob onDone={() => void refetch()} />
      </div>
      <div className="mb-5 rounded-md border border-workspace-sun-strong/40 bg-workspace-sun p-4 text-sm"><b>Safe testing is active.</b> Customer messages and external writes remain locked. Use separate role accounts for final permission testing.</div>
      {error ? <div role="alert" className="rounded-md border border-danger bg-danger-soft p-4 text-sm text-danger">Test records could not be loaded. Nothing has been deleted. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>
        : isPending ? <p className="text-sm text-muted-foreground">Loading test journeys…</p>
        : jobs.length === 0 ? <div className="rounded-md border border-dashed p-10 text-center"><FlaskConical className="mx-auto mb-2 h-7 w-7 text-primary" /><p className="font-semibold">No dummy journeys yet</p><p className="text-sm text-muted-foreground">Create one here so it is isolated from live work from the start.</p></div>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{jobs.map((job) => (
          <article key={job.id} className="rounded-md border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2"><div><div className="font-display text-lg font-bold">{job.job_number}</div><div className="text-sm text-muted-foreground">{job.property_address}</div></div><Badge variant="outline">TEST</Badge></div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">Owner</dt><dd>{job.owner_name}</dd><dt className="text-muted-foreground">Stage</dt><dd>{String(job.stage ?? "new enquiry").replaceAll("_", " ")}</dd><dt className="text-muted-foreground">Next action</dt><dd>{job.next_action ?? "Review test journey"}</dd></dl>
            <div className="mt-4 flex gap-2 border-t pt-3"><Button asChild size="sm"><Link to="/admin/jobs/$jobId" params={{ jobId: job.id! }}>Open journey</Link></Button><Button size="sm" variant="outline" disabled={deleting === job.id} onClick={async () => { setDeleting(job.id!); try { const result = await remove({ data: { jobIds: [job.id!], action: "delete", reason: "Removed from Test Centre" } }); if (result.done) toast.success("Test journey deleted"); else toast.error(result.failed[0]?.error ?? "Could not delete test journey"); await refetch(); } finally { setDeleting(null); } }}><Trash2 className="h-4 w-4" />Delete</Button></div>
          </article>
        ))}</div>}
    </AppShell>
  );
}

function CreateTestJob({ onDone }: { onDone: () => void }) {
  const create = useServerFn(createTestEnquiry);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(INITIAL);
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button><Plus className="h-4 w-4" />Create dummy journey</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Create isolated dummy journey</DialogTitle></DialogHeader>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const result = await create({ data: { full_name: form.full_name, email: form.email, phone: form.phone || null, address_line: form.address_line, suburb: form.suburb || null, postcode: form.postcode || null, state: "VIC", occupancy: form.occupancy, estimated_area_m2: Number(form.area), area_unknown: false, life_support: form.life, declared_property_type: form.property_type, declared_over_five_years: form.over_five_years, declared_previous_upgrade: form.previous_upgrade, base44_answers: { insulation: form.existing_insulation, top_floor: "yes" } } }); toast.success(`${result.job_number} created as a test journey`); setForm(INITIAL); setOpen(false); onDone(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create test journey"); } finally { setBusy(false); } }}>
        <p className="text-xs text-muted-foreground sm:col-span-2">These mirror the real online enquiry questions so Gate 1 behaves exactly as it would for a live customer.</p>
        <div><Label htmlFor="test-name">Owner name</Label><Input id="test-name" value={form.full_name} onChange={field("full_name")} required /></div>
        <div><Label htmlFor="test-email">Test email</Label><Input id="test-email" type="email" value={form.email} onChange={field("email")} required /></div>
        <div><Label htmlFor="test-phone">Phone</Label><Input id="test-phone" value={form.phone} onChange={field("phone")} /></div>
        <label className="text-sm"><span className="text-muted-foreground">Occupancy</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.occupancy} onChange={(event) => setForm({ ...form, occupancy: event.target.value as typeof form.occupancy })}><option value="owner_occupied">Owner-occupied</option><option value="rental">Rental</option></select></label>
        <div className="sm:col-span-2"><Label htmlFor="test-address">Street address</Label><Input id="test-address" value={form.address_line} onChange={field("address_line")} required /></div>
        <div><Label htmlFor="test-suburb">Suburb</Label><Input id="test-suburb" value={form.suburb} onChange={field("suburb")} required /></div>
        <div><Label htmlFor="test-postcode">Postcode</Label><Input id="test-postcode" value={form.postcode} onChange={field("postcode")} required /></div>
        <div><Label htmlFor="test-area">Estimated ceiling area m²</Label><Input id="test-area" type="number" min="1" max="5000" value={form.area} onChange={field("area")} required /></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><Checkbox checked={form.life} onCheckedChange={(value) => setForm({ ...form, life: !!value })} />Life support at property</label>
        <label className="text-sm"><span className="text-muted-foreground">Property type</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.property_type} onChange={(event) => setForm({ ...form, property_type: event.target.value as typeof form.property_type })}><option value="house">House</option><option value="townhouse">Townhouse</option><option value="unit">Unit / apartment</option></select></label>
        <label className="text-sm"><span className="text-muted-foreground">Owned the property 5+ years?</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.over_five_years} onChange={(event) => setForm({ ...form, over_five_years: event.target.value as typeof form.over_five_years })}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Not sure</option></select></label>
        <label className="text-sm"><span className="text-muted-foreground">Previous VEU upgrade?</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.previous_upgrade} onChange={(event) => setForm({ ...form, previous_upgrade: event.target.value as typeof form.previous_upgrade })}><option value="no">No</option><option value="yes">Yes</option><option value="unknown">Not sure</option></select></label>
        <label className="text-sm"><span className="text-muted-foreground">Existing ceiling insulation?</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.existing_insulation} onChange={(event) => setForm({ ...form, existing_insulation: event.target.value as typeof form.existing_insulation })}><option value="unknown">Not sure</option><option value="none">None</option><option value="some">Some insulation</option></select></label>
        <Button type="submit" className="sm:col-span-2" disabled={busy}>{busy ? "Creating…" : "Create test journey"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}