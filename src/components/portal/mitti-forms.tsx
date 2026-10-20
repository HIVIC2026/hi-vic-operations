import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/portal/badges";
import { FORMS, buildSheet, type FormKey } from "@/lib/mitti-forms.core";
import type { MittiFormHealth } from "@/lib/mitti-form-health.core";
import { checkSavedMittiForm, connectMittiForm, getMittiForms } from "@/lib/mitti-forms.functions";
import { MITTI_FORM_ORDER as ORDER } from "@/lib/template-catalog";

export function MittiFormsSection() {
  const get = useServerFn(getMittiForms);
  const { data: ids, isPending, error, refetch } = useQuery({ queryKey: ["mitti_forms"], queryFn: () => get() });
  return (
    <section className="my-6">
      <div className="mb-1 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold">Mitti forms</h2></div>
      <p className="mb-3 text-sm text-muted-foreground">Check a saved form to see its identity, required questions and approval status. To replace a form, paste its ID and use Check &amp; connect.</p>
      {isPending ? <p className="text-sm text-muted-foreground">Loading saved forms…</p>
        : error ? <div role="alert" className="text-sm text-destructive"><p>Saved form settings could not be loaded. Try again.</p><Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Retry</Button></div>
        : <div className="grid gap-3 lg:grid-cols-2">{ORDER.map(({ key }) => <MittiFormCard key={key} formKey={key} connected={ids?.[key] ?? null} />)}</div>}
    </section>
  );
}

function FormHealth({ result: h }: { result: MittiFormHealth }) {
  const issues = [...h.schemaIssues, ...(h.approvalBlocker ? [h.approvalBlocker] : [])];
  const when = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short" }).format(new Date(h.checkedAt));
  return (
    <div className="mt-3 rounded border bg-muted/40 p-3 text-xs" aria-live="polite">
      <p className={h.ok ? "font-semibold text-success" : "font-semibold"}>{h.ok ? "Form check passed" : h.approvalBlocker && h.schema === "valid" ? "Form reached · approval needed" : "Form check needs attention"}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt>Connection</dt><dd>{h.connectionMessage}</dd>
        <dt>Form name</dt><dd>{h.templateName ?? "Not returned by Mitti"}</dd>
        <dt>Returned ID</dt><dd className="break-all">{h.returnedId ?? "Not returned"}</dd>
        <dt>Identity</dt><dd>{h.identity === "verified" ? "Matches the saved form" : h.identity === "mismatch" ? "Different form returned" : h.identity === "missing" ? "Could not verify" : "Not checked"}</dd>
        <dt>Required questions</dt><dd>{h.schema === "valid" ? "All required questions found" : h.schema === "invalid" ? "Needs correction" : "Not checked"}</dd>
        {(h.key === "piesa" || h.key === "piisa") && <><dt>Official approval</dt><dd>{h.approvalBlocker ? "Required before this form can be used" : "Current mapping permits use"}</dd></>}
        <dt>Checked</dt><dd>{when} Melbourne time</dd>
      </dl>
      {issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-destructive">{issues.slice(0, 12).map((issue, i) => <li key={i}>{issue}</li>)}{issues.length > 12 && <li>…and {issues.length - 12} more</li>}</ul>}
    </div>
  );
}

/** Checking a saved form is read-only. Check & connect is a separate, explicit configuration change. */
export function MittiFormCard({ formKey: key, connected }: { formKey: FormKey; connected: string | null }) {
  const connect = useServerFn(connectMittiForm);
  const check = useServerFn(checkSavedMittiForm);
  const qc = useQueryClient();
  const meta = ORDER.find((o) => o.key === key)!;
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [r, setResult] = useState<{ ok: boolean; issues: string[]; templateName?: string | null } | null>(null);
  const [health, setHealth] = useState<MittiFormHealth | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"check" | "connect" | null>(null);
  const displayedId = draft ?? connected ?? "";
  const currentHealth = health?.savedId === connected ? health : null;
  return (
    <article className="rounded-md border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-bold uppercase tracking-wide text-primary">{meta.letter} · {meta.forWho}</p><h3 className="font-bold">{FORMS[key].title}</h3></div>{connected ? <Pill t="neutral">ID saved</Pill> : <Pill t="warn">No ID saved</Pill>}</div>
      <p className="mt-1 text-xs text-muted-foreground">{meta.who} · {FORMS[key].fields.length} questions</p>
      {connected && <p className="mt-1 break-all text-xs text-muted-foreground">Saved ID: {connected}</p>}
      {!currentHealth && <p className="mt-1 text-xs text-muted-foreground">Connection and form health have not been checked for this saved ID during this visit.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={async () => {
          setBusy("check"); setCheckError(null); setHealth(null);
          try {
            const result = await check({ data: { key } });
            setHealth(result);
            await qc.invalidateQueries({ queryKey: ["mitti_forms"] });
          } catch (e) { setCheckError(e instanceof Error ? e.message : "The saved form could not be checked. Try again."); }
          finally { setBusy(null); }
        }}>{busy === "check" ? "Checking…" : connected ? "Check saved form" : "Check setup"}</Button>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>{open ? "Hide build sheet" : "View build sheet"}</Button>
      </div>
      {checkError && <p role="alert" className="mt-2 text-xs text-destructive">{checkError}</p>}
      {currentHealth && <FormHealth result={currentHealth} />}
      {open && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{buildSheet(key)}</pre>}
      <div className="mt-3 flex flex-wrap gap-2"><Input className="min-w-0 flex-1" aria-label={meta.letter + " Mitti form ID"} placeholder="template_…" value={displayedId} disabled={busy !== null} onChange={(e) => { setDraft(e.target.value); setResult(null); }} /><Button size="sm" disabled={busy !== null || !displayedId.trim()} onClick={async () => {
        setBusy("connect"); setResult(null);
        try {
          const res = await connect({ data: { key, templateId: displayedId.trim() } });
          setResult(res);
          if (res.ok) { setDraft(undefined); setHealth(null); setCheckError(null); }
          await qc.invalidateQueries({ queryKey: ["mitti_forms"] });
        } catch (e) { setResult({ ok: false, issues: [e instanceof Error ? e.message : "The connection result could not be confirmed. Check the saved ID before trying again."] }); await qc.invalidateQueries({ queryKey: ["mitti_forms"] }); }
        finally { setBusy(null); }
      }}>{busy === "connect" ? "Connecting…" : "Check & connect"}</Button></div>
      {r && (r.ok ? <p className="mt-2 text-sm font-semibold text-success">Form validated and connected{r.templateName ? ": " + r.templateName : "."}</p> : <ul role="alert" className="mt-2 list-disc pl-5 text-xs text-destructive">{r.issues.slice(0, 12).map((i) => <li key={i}>{i}</li>)}{r.issues.length > 12 && <li>…and {r.issues.length - 12} more</li>}</ul>)}
    </article>
  );
}
