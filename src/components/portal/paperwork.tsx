// Office: owner paperwork strip A/B/C/D on the job page, plus landlord-consent recording for tenant jobs.
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { jobPaperworkFn, recordLandlordConsentFn } from "@/lib/owner-gates.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = { key: string; label: string; done: boolean; draft: boolean; note?: string };
type Gate = { gate: string; label: string; complete: boolean; items: Item[]; blockers: string[] };

export function PaperworkStrip({ jobId }: { jobId: string }) {
  const load = useServerFn(jobPaperworkFn);
  const record = useServerFn(recordLandlordConsentFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["job-paperwork", jobId], queryFn: () => load({ data: { jobId } }) });
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ recordedBy: "", landlordName: "", howReceived: "" });
  const [err, setErr] = useState("");
  if (!data) return null;
  const gates = data.gates as Gate[];
  const needsLandlord = gates.some((g) => g.items.some((i) => i.key === "landlord_consent" && !i.done));
  return (
    <section data-testid="paperwork-strip" className="mb-3 rounded-2xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Paperwork</span>
        {gates.map((g) => (
          <button key={g.gate} type="button" onClick={() => setOpen(open === g.gate ? null : g.gate)} title={g.label}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ${g.complete ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>
            {g.gate} {g.complete ? <Check className="h-4 w-4" aria-label="done" /> : <X className="h-4 w-4" aria-label="missing" />}
          </button>
        ))}
      </div>
      {open && (() => { const g = gates.find((x) => x.gate === open)!; return (
        <ul className="mt-2 space-y-1 text-sm">
          <li className="font-semibold">{g.gate}: {g.label}</li>
          {g.items.map((i) => <li key={i.key} className="flex items-center gap-2">{i.done ? <Check className="h-4 w-4 text-success" /> : <X className="h-4 w-4 text-destructive" />}{i.label}{i.draft && <span className="rounded bg-muted px-1.5 text-xs font-bold">DRAFT</span>}{i.note && <span className="text-xs text-muted-foreground">({i.note})</span>}</li>)}
        </ul>); })()}
      {needsLandlord && (
        <form className="mt-3 grid gap-2 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); setErr(""); try { await record({ data: { jobId, ...f } }); await qc.invalidateQueries({ queryKey: ["job-paperwork", jobId] }); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); } }}>
          <Input placeholder="Landlord name" value={f.landlordName} onChange={(e) => setF({ ...f, landlordName: e.target.value })} />
          <Input placeholder="How received (e.g. signed letter, email)" value={f.howReceived} onChange={(e) => setF({ ...f, howReceived: e.target.value })} />
          <Input placeholder="Your full name" value={f.recordedBy} onChange={(e) => setF({ ...f, recordedBy: e.target.value })} />
          <Button type="submit">Record landlord consent</Button>
          {err && <p role="alert" className="text-sm text-destructive sm:col-span-4">{err}</p>}
        </form>
      )}
    </section>
  );
}
