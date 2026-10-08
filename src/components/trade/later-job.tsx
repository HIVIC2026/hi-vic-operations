import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CustomerFields } from "./customer-fields";
import { Button, Section } from "./trade-ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-me";
import { startOnsiteReadyCheck } from "@/lib/onsite-ready-check.functions";
import { onsiteProblems, type OnsiteInput } from "@/lib/onsite-ready-check.core";
import { laterReadyCheckProblems } from "@/lib/later-ready-check.core";

export function LaterJob({ businessId, onBack }: { businessId: string; onBack: () => void }) {
  const [owner, setOwner] = useState<OnsiteInput>({ full_name: "", phone: "", email: "", address_line: "", suburb: "", postcode: "", contact_permission: false, consent_by: null });
  const [date, setDate] = useState("");
  const [manual, setManual] = useState(false);
  const [area, setArea] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const save = useAction(startOnsiteReadyCheck);
  const navigate = useNavigate();
  return <div className="space-y-4">
    <Section title="Homeowner details"><CustomerFields value={owner} onChange={setOwner} /></Section>
    <label className="block text-sm font-bold">Booked Ready Check date and time<Input type="datetime-local" className="mt-1 h-12 min-w-0 w-full" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    <Section title="Measurements"><div className="grid grid-cols-2 gap-2"><Button size="field" variant={!manual ? "default" : "outline"} onClick={() => setManual(false)}>Add later</Button><Button size="field" variant={manual ? "default" : "outline"} onClick={() => setManual(true)}>Enter manually</Button></div>
      {manual && <div className="mt-3 space-y-3"><label className="block text-sm font-bold">Ceiling area (m²)<Input className="mt-1 h-12" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label><label className="block text-sm font-bold">How was it measured?<Input className="mt-1 h-12" maxLength={200} value={method} onChange={(e) => setMethod(e.target.value)} /></label><label className="block text-sm font-bold">Other measurements and site details<Textarea className="mt-1" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>}
    </Section>
    <p className="text-sm text-sub">Supplied measurements await verification. The appointment remains subject to the existing booking checks.</p>
    {problems.length > 0 && <ul className="text-sm text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    <Button size="field" className="w-full" disabled={busy} onClick={async () => {
      const later = { startsAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : "", ...(manual && area.trim() ? { area: Number(area) } : {}), ...(manual ? { method, notes } : {}) };
      const errors = [...onsiteProblems(owner), ...laterReadyCheckProblems(later)]; setProblems(errors); if (errors.length) return;
      setBusy(true); try { const result = await save({ businessId, owner, electrician: { mode: "hivic" }, later }); if (result) await navigate({ to: "/field/$jobId", params: { jobId: result.jobId } }); } finally { setBusy(false); }
    }}>{busy ? "Adding…" : "Add job for later"}</Button>
    <Button variant="outline" size="field" onClick={onBack}>Back</Button>
  </div>;
}