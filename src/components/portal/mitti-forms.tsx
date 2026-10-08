import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/portal/badges";
import { FORMS, buildSheet, type FormKey } from "@/lib/mitti-forms.core";
import { connectMittiForm, getMittiForms } from "@/lib/mitti-forms.functions";

import { MITTI_FORM_ORDER as ORDER } from "@/lib/template-catalog";

export function MittiFormsSection() {
  const get = useServerFn(getMittiForms);
  const { data: ids } = useQuery({ queryKey: ["mitti_forms"], queryFn: () => get() });
  return (
    <section className="my-6">
      <div className="mb-1 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold">Mitti forms</h2></div>
      <p className="mb-3 text-sm text-muted-foreground">Build each form in Mitti using its build sheet, then paste its ID here. The portal checks every required question before connecting it, and nothing is sent automatically.</p>
      <div className="grid gap-3 lg:grid-cols-2">{ORDER.map(({ key }) => <MittiFormCard key={key} formKey={key} connected={ids?.[key] ?? null} />)}</div>
    </section>
  );
}

/** One Mitti form card. "Check & connect" only runs when the office presses it (it calls Mitti). */
export function MittiFormCard({ formKey: key, connected }: { formKey: FormKey; connected: string | null }) {
  const connect = useServerFn(connectMittiForm);
  const qc = useQueryClient();
  const meta = ORDER.find((o) => o.key === key)!;
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [r, setResult] = useState<{ ok: boolean; issues: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const displayedId = draft ?? connected ?? "";
  return (
    <article className="rounded-md border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-bold uppercase tracking-wide text-primary">{meta.letter} · {meta.forWho}</p><h3 className="font-bold">{FORMS[key].title}</h3></div>{connected ? <Pill t="neutral">ID saved</Pill> : <Pill t="warn">No ID saved</Pill>}</div>
      <p className="mt-1 text-xs text-muted-foreground">{meta.who} · {FORMS[key].fields.length} questions</p>
      <p className="mt-1 text-xs text-muted-foreground">Live connection health not checked.</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(!open)}>{open ? "Hide build sheet" : "View build sheet"}</Button>
      {open && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{buildSheet(key)}</pre>}
      <div className="mt-3 flex flex-wrap gap-2"><Input className="min-w-0 flex-1" aria-label={`${meta.letter} Mitti form ID`} placeholder="template_…" value={displayedId} onChange={(e) => setDraft(e.target.value)} /><Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const res = await connect({ data: { key, templateId: displayedId.trim() } }); setResult(res); qc.invalidateQueries({ queryKey: ["mitti_forms"] }); }
        catch (e) { setResult({ ok: false, issues: [e instanceof Error ? e.message : "Could not check this form."] }); }
        finally { setBusy(false); }
      }}>Check &amp; connect</Button></div>
      {r && (r.ok ? <p className="mt-2 text-sm font-semibold text-success">All required questions found. Form connected.</p> : <ul className="mt-2 list-disc pl-5 text-xs text-destructive">{r.issues.slice(0, 12).map((i) => <li key={i}>{i}</li>)}{r.issues.length > 12 && <li>…and {r.issues.length - 12} more</li>}</ul>)}
    </article>
  );
}
