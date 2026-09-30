import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/portal/badges";
import { FORMS, buildSheet, type FormKey } from "@/lib/mitti-forms.core";
import { connectMittiForm, getMittiForms } from "@/lib/mitti-forms.functions";

const ORDER: { key: FormKey; letter: string; who: string }[] = [
  { key: "ready_check", letter: "A", who: "Installer · free Ready Check before the PIESA" },
  { key: "piesa", letter: "B", who: "Licensed electrician · official DEECA PIESA" },
  { key: "piisa", letter: "C", who: "Lead installer · official DEECA PIISA on install day" },
];

export function MittiFormsSection() {
  const get = useServerFn(getMittiForms);
  const connect = useServerFn(connectMittiForm);
  const qc = useQueryClient();
  const { data: ids } = useQuery({ queryKey: ["mitti_forms"], queryFn: () => get() });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, { ok: boolean; issues: string[] }>>({});
  const [open, setOpen] = useState<FormKey | null>(null);
  const [busy, setBusy] = useState<FormKey | null>(null);
  return (
    <section className="my-6">
      <div className="mb-1 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold">Mitti forms</h2></div>
      <p className="mb-3 text-sm text-muted-foreground">Build each form in Mitti using its build sheet, then paste its ID here. The portal checks every required question before connecting it, and nothing is sent automatically.</p>
      <div className="grid gap-3 lg:grid-cols-3">{ORDER.map(({ key, letter, who }) => {
        const connected = ids?.[key];
        const r = result[key];
        return (
          <article key={key} className="rounded-md border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{letter}. {FORMS[key].title}</h3>{connected ? <Pill t="good">Connected</Pill> : <Pill t="warn">Not connected</Pill>}</div>
            <p className="mt-1 text-xs text-muted-foreground">{who} · {FORMS[key].fields.length} questions</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(open === key ? null : key)}>{open === key ? "Hide build sheet" : "View build sheet"}</Button>
            {open === key && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{buildSheet(key)}</pre>}
            <div className="mt-3 flex gap-2"><Input placeholder="template_…" value={draft[key] ?? connected ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /><Button size="sm" disabled={busy === key} onClick={async () => {
              setBusy(key);
              try { const res = await connect({ data: { key, templateId: (draft[key] ?? "").trim() } }); setResult({ ...result, [key]: res }); qc.invalidateQueries({ queryKey: ["mitti_forms"] }); }
              catch (e) { setResult({ ...result, [key]: { ok: false, issues: [e instanceof Error ? e.message : "Could not check this form."] } }); }
              finally { setBusy(null); }
            }}>Check &amp; connect</Button></div>
            {r && (r.ok ? <p className="mt-2 text-sm font-semibold text-success">All required questions found. Form connected.</p> : <ul className="mt-2 list-disc pl-5 text-xs text-destructive">{r.issues.slice(0, 12).map((i) => <li key={i}>{i}</li>)}{r.issues.length > 12 && <li>…and {r.issues.length - 12} more</li>}</ul>)}
          </article>
        );
      })}</div>
    </section>
  );
}
