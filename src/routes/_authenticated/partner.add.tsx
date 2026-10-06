import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { TradeTabs } from "@/components/portal/trade-work";
import { supabase } from "@/integrations/supabase/client";
import { confirmImport, createImport, myInstallerRateItems, partnerUploadUrl } from "@/lib/pilot.functions";
import { addCustomerProblems, areaTotal, type A1Area } from "@/lib/add-customer.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { melbourneToday } from "@/lib/melbourne-time.core";

export const Route = createFileRoute("/_authenticated/partner/add")({
  head: () => ({ meta: [{ title: "Add your own customer – Home Insulation Victoria" }, { name: "description", content: "Add a customer you found, at whatever stage you're up to." }, { property: "og:title", content: "Add your own customer – Home Insulation Victoria" }, { property: "og:description", content: "Add a customer you found, at whatever stage you're up to." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AddCustomer,
});

type Progress = "not_visited" | "measured" | "quoted";
const blankArea = (): A1Area => ({ name: "", length: "", width: "", existing: null, type: "", depth: "", depthPhoto: null, action: null, downlights: "", hazards: "", hazardPhoto: null });

function AddCustomer() {
  const nav = useNavigate();
  const create = useServerFn(createImport);
  const confirm = useServerFn(confirmImport);
  const upload = useServerFn(partnerUploadUrl);
  const loadRates = useServerFn(myInstallerRateItems);
  const { data: rates } = useQuery({ queryKey: ["my-installer-rates"], queryFn: () => loadRates() });
  const [o, setO] = useState({ full_name: "", phone: "", email: "", address_line: "", suburb: "", postcode: "", occupancy: "owner_occupied" as "owner_occupied" | "rental", rough: "" });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [areas, setAreas] = useState<A1Area[]>([blankArea()]);
  const [how, setHow] = useState("");
  const [roof5, setRoof5] = useState<boolean | null>(null);
  const [files, setFiles] = useState<Record<string, { path: string; name: string; type: string } | null>>({ sketch: null, access: null });
  const [lines, setLines] = useState<{ code: string; qty: string }[]>([]);
  const [agreed, setAgreed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof typeof o) => (e: React.ChangeEvent<HTMLInputElement>) => setO({ ...o, [k]: e.target.value });
  const total = areaTotal(areas);
  const priced = useMemo(() => lines.map((l) => { const r = rates?.items.find((x) => x.code === l.code); return { ...l, r, amount: r ? Math.round(r.price_inc_gst * Number(l.qty || 0) * 100) / 100 : 0 }; }), [lines, rates]);
  const sum = priced.reduce((a, l) => a + l.amount, 0);

  const sendFile = async (key: string, f: File | undefined) => {
    if (!f || !rates?.businessId) return;
    try {
      const u = await upload({ data: { businessId: rates.businessId, folder: "imports", fileName: f.name } });
      const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(u.path, u.token, f);
      if (error) throw error;
      setFiles((x) => ({ ...x, [key]: { path: u.path, name: f.name, type: f.type } }));
    } catch { toast.error("That photo didn't upload. Check your signal and try again."); }
  };
  const photo = (key: string, label: string) => (
    <label className="block text-sm font-medium">{label}
      <input type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" onChange={(e) => sendFile(key, e.target.files?.[0])} />
      {files[key] && <span className="text-xs text-success">Added: {files[key]!.name}</span>}
    </label>
  );

  const submit = async () => {
    const problems = addCustomerProblems({ owner: o, progress, areas, how, roof5, sketch: !!files["sketch"], access: !!files["access"], lines: priced.map((l) => ({ code: l.code, qty: Number(l.qty) })), agreed });
    setErrors(problems);
    if (problems.length || !rates?.businessId || !progress) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setBusy(true);
    try {
      const fileList = Object.values(files).filter(Boolean) as { path: string; name: string; type: string }[];
      const draft = await create({ data: { businessId: rates.businessId, sourceSystem: "manual_import", files: fileList } });
      const area = progress === "not_visited" ? Number(o.rough) : total;
      const anyRemoval = areas.some((a) => a.action === "remove");
      const facts = { full_name: o.full_name, email: o.email, phone: o.phone || null, address_line: o.address_line, suburb: o.suburb || null, postcode: o.postcode || null, measured_area_m2: area,
        ...(progress !== "not_visited" ? { removal_required: anyRemoval, removal_m2: anyRemoval ? areaTotal(areas.filter((a) => a.action === "remove")) : 0, measurement_method: how, measured_on: melbourneToday(), measurement_purpose: "onsite" } : {}) };
      const details = progress === "not_visited" ? undefined : { areas, how, roof_built_or_replaced_last_5_years: roof5, files: fileList, price_lines: priced.map((l) => ({ code: l.code, description: l.r?.description, qty: Number(l.qty), unit_price_inc_gst: l.r?.price_inc_gst, amount_inc_gst: l.amount })), total_inc_gst: progress === "quoted" ? sum : null, owner_agreed: progress === "quoted" ? agreed : null };
      const r = await confirm({ data: { importId: draft.id, facts, progress, occupancy: o.occupancy, ...(details ? { details } : {}) } });
      toast.success(progress === "not_visited" ? "Saved — book the Ready Check from My work." : "Sent to Home Insulation Victoria.");
      nav({ to: "/field/$jobId", params: { jobId: r.jobId } });
    } catch (e) { setErrors([e instanceof Error ? e.message : "Something went wrong. Please try again."]); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };

  const card = "rounded-[22px] border bg-card p-4 shadow-sm";
  return (
    <AppShell>
      <div className="space-y-4 pb-24">
        <div><h1 className="font-display text-2xl font-extrabold">Add your own customer</h1><p className="text-sm text-muted-foreground">Fill this in once. We never ask again for anything you put here.</p></div>
        {errors.length > 0 && <div role="alert" className="rounded-[22px] border border-danger/40 bg-danger-soft p-3 text-sm text-danger"><div className="font-semibold">Nearly there — please fix:</div><ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
        <section className={card}>
          <h2 className="mb-3 font-display text-lg font-extrabold">1 · Owner and home</h2>
          <div className="grid gap-3">
            <div><Label htmlFor="ac-1">Owner name</Label><Input id="ac-1" className="h-12" value={o.full_name} onChange={set("full_name")} autoComplete="off" /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="ac-2">Mobile</Label><Input id="ac-2" className="h-12" type="tel" inputMode="tel" value={o.phone} onChange={set("phone")} /></div><div><Label htmlFor="ac-3">Email</Label><Input id="ac-3" className="h-12" type="email" value={o.email} onChange={set("email")} /></div></div>
            <div><Label htmlFor="ac-4">Street address</Label><Input id="ac-4" className="h-12" value={o.address_line} onChange={set("address_line")} /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="ac-5">Suburb</Label><Input id="ac-5" className="h-12" value={o.suburb} onChange={set("suburb")} /></div><div><Label htmlFor="ac-6">Postcode</Label><Input id="ac-6" className="h-12" inputMode="numeric" value={o.postcode} onChange={set("postcode")} /></div></div>
            <div><Label>Who lives there?</Label><div className="mt-1 grid grid-cols-2 gap-2">{(["owner_occupied", "rental"] as const).map((v) => <Button key={v} type="button" size="field" variant={o.occupancy === v ? "default" : "outline"} onClick={() => setO({ ...o, occupancy: v })}>{v === "owner_occupied" ? "Owner lives there" : "Rental"}</Button>)}</div></div>
            <div><Label>Where are you up to?</Label><div className="mt-1 grid gap-2">{([["not_visited", "Not visited yet"], ["measured", "Visited and measured"], ["quoted", "Measured and quoted"]] as const).map(([v, l]) => <Button key={v} type="button" size="field" variant={progress === v ? "default" : "outline"} onClick={() => setProgress(v)}>{l}</Button>)}</div></div>
            {progress === "not_visited" && <div><Label htmlFor="ac-7">Rough ceiling size (m²)</Label><Input id="ac-7" className="h-12" inputMode="decimal" value={o.rough} onChange={set("rough")} placeholder="Your best guess" /></div>}
          </div>
        </section>

        {progress && progress !== "not_visited" && <>
          <section className={card}>
            <h2 className="mb-1 font-display text-lg font-extrabold">2 · Ready Check summary</h2>
            <p className="mb-3 text-sm text-muted-foreground">One block per ceiling area. Area works itself out from length × width.</p>
            <div className="space-y-4">
              {areas.map((a, i) => { const up = (p: Partial<A1Area>) => setAreas(areas.map((x, j) => (j === i ? { ...x, ...p } : x))); const m2 = Number(a.length) * Number(a.width); return (
                <div key={i} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between"><div className="font-semibold">Area {i + 1}{m2 > 0 ? ` · ${Math.round(m2 * 10) / 10} m²` : ""}</div>{areas.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setAreas(areas.filter((_, j) => j !== i))} aria-label="Remove area"><Trash2 className="h-4 w-4" /></Button>}</div>
                  <div className="mt-2 grid gap-2">
                    <Input className="h-12" placeholder="Name, e.g. Main house" value={a.name} onChange={(e) => up({ name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2"><Input className="h-12" inputMode="decimal" placeholder="Length (m)" value={a.length} onChange={(e) => up({ length: e.target.value })} /><Input className="h-12" inputMode="decimal" placeholder="Width (m)" value={a.width} onChange={(e) => up({ width: e.target.value })} /></div>
                    <div className="text-sm font-medium">Existing insulation?</div>
                    <div className="grid grid-cols-2 gap-2">{[true, false].map((v) => <Button key={String(v)} type="button" size="field" variant={a.existing === v ? "default" : "outline"} onClick={() => up({ existing: v })}>{v ? "Yes" : "No"}</Button>)}</div>
                    {a.existing && <>
                      <div className="grid grid-cols-2 gap-2"><Input className="h-12" placeholder="Type, e.g. batts" value={a.type} onChange={(e) => up({ type: e.target.value })} /><Input className="h-12" inputMode="numeric" placeholder="Depth (mm)" value={a.depth} onChange={(e) => up({ depth: e.target.value })} /></div>
                      <label className="block text-sm font-medium">Depth photo (ruler showing)<input type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" onChange={async (e) => { await sendFile(`depth${i}`, e.target.files?.[0]); up({ depthPhoto: e.target.files?.[0]?.name ?? null }); }} /></label>
                      <div className="grid grid-cols-2 gap-2">{(["remove", "top_up"] as const).map((v) => <Button key={v} type="button" size="field" variant={a.action === v ? "default" : "outline"} onClick={() => up({ action: v })}>{v === "remove" ? "Remove" : "Top up"}</Button>)}</div>
                    </>}
                    <Input className="h-12" inputMode="numeric" placeholder="Downlights (how many)" value={a.downlights} onChange={(e) => up({ downlights: e.target.value })} />
                    <Input className="h-12" placeholder="Hazards (leave blank if none)" value={a.hazards} onChange={(e) => up({ hazards: e.target.value })} />
                    {a.hazards.trim() && <label className="block text-sm font-medium">Hazard photo<input type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" onChange={async (e) => { await sendFile(`hazard${i}`, e.target.files?.[0]); up({ hazardPhoto: e.target.files?.[0]?.name ?? null }); }} /></label>}
                  </div>
                </div>
              ); })}
              <Button type="button" variant="outline" size="field" className="w-full" onClick={() => setAreas([...areas, blankArea()])}><Plus /> Add another area</Button>
              <div className="rounded-xl bg-secondary p-3 text-sm font-semibold">Total ceiling area: {Math.round(total * 10) / 10} m²</div>
              <div><Label>How did you measure?</Label><div className="mt-1 grid grid-cols-3 gap-2">{["laser", "tape", "floorplan"].map((v) => <Button key={v} type="button" size="field" variant={how === v ? "default" : "outline"} onClick={() => setHow(v)}>{v === "floorplan" ? "Floor plan" : v[0]!.toUpperCase() + v.slice(1)}</Button>)}</div></div>
              {photo("sketch", "Area sketch or floor plan (required)")}
              {photo("access", "Ceiling access (manhole) photo")}
              <div><Label>Roof built or replaced in the last 5 years?</Label><div className="mt-1 grid grid-cols-2 gap-2">{[true, false].map((v) => <Button key={String(v)} type="button" size="field" variant={roof5 === v ? "default" : "outline"} onClick={() => setRoof5(v)}>{v ? "Yes" : "No"}</Button>)}</div></div>
            </div>
          </section>

          <section className={card}>
            <h2 className="mb-1 font-display text-lg font-extrabold">3 · Price</h2>
            <p className="mb-3 text-sm text-muted-foreground">From your agreed rates (inc GST). Add an R5.0 line{areas.some((a) => a.action === "remove") ? " and a removal line" : ""}.</p>
            {!rates?.items.length && <p className="text-sm text-danger">Your agreed rates aren't set up yet — Home Insulation Victoria will add them.</p>}
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_auto] gap-2">
                  <select className="h-12 rounded-xl border bg-background px-2 text-sm" value={l.code} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}><option value="">Choose a line</option>{rates?.items.map((r) => <option key={r.code} value={r.code}>{r.description} · ${r.price_inc_gst}/{r.unit === "m2" ? "m²" : r.unit}</option>)}</select>
                  <Input className="h-12" inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label="Quantity" />
                  <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="field" className="w-full" onClick={() => setLines([...lines, { code: "", qty: String(Math.round(total * 10) / 10 || "") }])}><Plus /> Add a price line</Button>
              <div className="flex justify-between rounded-xl bg-secondary p-3 font-semibold"><span>Total</span><span>${sum.toFixed(2)} inc GST</span></div>
              {progress === "quoted" && <div><Label>Has the owner agreed to this price?</Label><div className="mt-1 grid grid-cols-2 gap-2">{[true, false].map((v) => <Button key={String(v)} type="button" size="field" variant={agreed === v ? "default" : "outline"} onClick={() => setAgreed(v)}>{v ? "Yes" : "Not yet"}</Button>)}</div></div>}
            </div>
          </section>
        </>}

        {progress && <Button size="field" className="w-full" disabled={busy} onClick={submit}>{busy ? "Saving…" : progress === "not_visited" ? "Save customer" : "Check & send"}</Button>}
        <div className={card}><div className="font-semibold">Many at once</div><p className="text-sm text-muted-foreground">Got a list, a spreadsheet or a folder of photos?</p><Link to="/partner/bulk-import" className="mt-2 inline-block font-semibold text-primary underline">Upload many customers</Link></div>
      </div>
      <TradeTabs installer />
    </AppShell>
  );
}
