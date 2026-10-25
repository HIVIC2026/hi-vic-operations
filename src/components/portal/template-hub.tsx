// Office Templates page (decision 379): only what the portal sends or shows today, grouped by who gets it and in job
// order, each rendered from the live builder with TEST sample data (template-hub.core.ts). Read-only: viewing never
// sends, saves or connects anything (the Mitti card keeps its own existing "Check & connect" button).
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight } from "lucide-react";
import { Pill, fieldInput, type PillTone } from "./kit";
import { MittiFormCard } from "./mitti-forms";
import { cn } from "@/lib/utils";
import {
  KIND_LABEL, STEP_LABEL, STEP_ORDER, TEMPLATE_SECTIONS, entriesFor, templateStatus,
  type SwitchStates, type TemplateEntry, type TemplatePreview, type TemplateSection,
} from "@/lib/template-hub.core";
import type { FormKey } from "@/lib/mitti-forms.core";
import { getMittiForms } from "@/lib/mitti-forms.functions";
import { getOfficeSwitches } from "@/lib/office-settings.functions";
import { paperworkCatalogueFn } from "@/lib/owner-gates.functions";

/** Approved page designs (My job P-pages, the P5 notice page), loaded only when opened. */
const PAGE_FILES = import.meta.glob(["/docs/templates/owner/P*.html", "/docs/templates/installer/P*.html"], { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
/** Compliance samples, official originals and product warranties: served as files, opened in a new tab. */
const DOC_FILES = import.meta.glob(["/docs/templates/compliance/**/*.pdf", "/docs/official-forms/*.docx", "/docs/product-warranties/*.pdf"], { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;

const TONE: Record<"green" | "amber" | "rose" | "neutral", PillTone> = { green: "green", amber: "amber", rose: "rose", neutral: "plain" };
const MITTI_KEY: Record<string, FormKey> = { A1: "ready_check_priced", A2: "ready_check", A3: "piisa", A4: "piesa", A5: "fixes" };

export function TemplatesHub({ cat, t }: { cat: TemplateSection; t?: string }) {
  const navigate = useNavigate();
  const list = entriesFor(cat);
  const selected = list.find((e) => e.id === t) ?? list[0];
  const choose = (id: string) => navigate({ to: "/admin/templates", search: { cat, t: id }, replace: true });
  const steps = STEP_ORDER.filter((s) => list.some((e) => e.step === s));
  const getSwitches = useServerFn(getOfficeSwitches);
  const sw = useQuery({ queryKey: ["office-switches"], queryFn: () => getSwitches(), staleTime: 60_000 });
  const switches: SwitchStates | null = sw.data ? Object.fromEntries(sw.data.switches.map((s) => [s.key, s.on])) : null;
  const section = TEMPLATE_SECTIONS.find((s) => s.key === cat)!;
  return (
    <div>
      <header className="mb-4">
        <h1 className="font-display text-[26px] font-bold leading-tight">Templates</h1>
        <p className="mt-1 text-sm text-sub">Only what the portal sends or shows today, exactly as people see it — rendered from the live code with TEST sample data. Viewing never sends, saves or connects anything.</p>
      </header>
      <nav aria-label="Who gets it" className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {TEMPLATE_SECTIONS.map((c) => (
          <Link key={c.key} to="/admin/templates" search={{ cat: c.key }} aria-current={c.key === cat ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", c.key === cat ? "border-hiv-blue text-ink" : "border-transparent text-sub hover:text-ink", c.key === "waiting" && "text-rose")}>
            {c.label} <span className="text-xs font-normal text-sub">{entriesFor(c.key).length}</span>
          </Link>
        ))}
      </nav>
      <p className="mb-3 text-xs text-sub">{section.hint}{sw.isError ? " · Switch states could not load." : ""}</p>
      {cat === "waiting" && <p className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">Nothing here is sent to anyone until Jo approves the wording.</p>}
      {!selected ? <p className="rounded-md border bg-card p-6 text-sm text-sub">Nothing in this section.</p> : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            <label className="block lg:hidden"><span className="sr-only">Choose a template</span>
              <select aria-label="Choose a template" className={fieldInput} value={selected.id} onChange={(e) => choose(e.target.value)}>
                {steps.map((s) => <optgroup key={s} label={STEP_LABEL[s]}>{list.filter((e) => e.step === s).map((e) => <option key={e.id} value={e.id}>{e.code ? `${e.code} · ` : ""}{e.name}</option>)}</optgroup>)}
              </select>
            </label>
            <div className="hidden space-y-3 lg:block" role="listbox" aria-label="Templates">
              {steps.map((s) => (
                <div key={s}>
                  <p className="px-2 pb-1 text-[11px] font-bold uppercase text-sub">{STEP_LABEL[s]}</p>
                  {list.filter((e) => e.step === s).map((e) => (
                    <button key={e.id} type="button" role="option" aria-selected={e.id === selected.id} onClick={() => choose(e.id)}
                      className={cn("flex w-full items-baseline gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm", e.id === selected.id ? "bg-mist font-semibold text-ink" : "text-sub hover:bg-mist/60 hover:text-ink")}>
                      <span className="w-10 shrink-0 text-[11px] font-bold text-hiv-blue">{e.code || KIND_LABEL[e.kind]}</span>
                      <span className="min-w-0">{e.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <section aria-label="Selected template" className="min-w-0"><TemplateDetail key={selected.id} entry={selected} switches={switches} /></section>
        </div>
      )}
    </div>
  );
}

function TemplateDetail({ entry, switches }: { entry: TemplateEntry; switches: SwitchStates | null }) {
  const status = templateStatus(entry, switches);
  const preview = useMemo<{ ok: true; p: TemplatePreview } | { ok: false; error: string }>(() => {
    try { return { ok: true, p: entry.render() }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  }, [entry]);
  const mittiKey = entry.section === "mitti" ? MITTI_KEY[entry.code] : undefined;
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-line bg-paper p-4">
        <p className="text-[11px] font-bold uppercase text-hiv-blue">{KIND_LABEL[entry.kind]} · {STEP_LABEL[entry.step]}</p>
        <h2 className="font-display text-xl font-bold">{entry.code ? `${entry.code} · ` : ""}{entry.name}</h2>
        <dl className="mt-3 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-sub">Who gets it</dt><dd>{entry.who}</dd>
          <dt className="text-sub">When</dt><dd>{entry.when}</dd>
          <dt className="text-sub">Status</dt><dd><Pill tone={TONE[status.tone]}>{status.label}</Pill></dd>
          <dt className="text-sub">Approved</dt><dd>{entry.approval === "waiting" ? <span className="text-rose">Waiting for Jo — {entry.approvalNote}</span> : entry.approvalNote}</dd>
          <dt className="text-sub">Live code</dt><dd className="break-all text-xs"><code>{entry.source.fn}</code> in <code>{entry.source.builder}</code>, used by <code>{entry.source.sender}</code></dd>
          {entry.design && <><dt className="text-sub">Design file</dt><dd className="break-all text-xs"><code>{entry.design}</code></dd></>}
        </dl>
        {entry.paperworkKey && <PaperworkApproval docKey={entry.paperworkKey} />}
      </div>
      {preview.ok ? <Preview p={preview.p} /> : <p role="alert" className="rounded-[14px] border border-line bg-paper p-4 text-sm text-rose">This template could not be rendered with sample data: {preview.error}</p>}
      {mittiKey && <MittiConnection formKey={mittiKey} />}
    </div>
  );
}

function Preview({ p }: { p: TemplatePreview }) {
  switch (p.kind) {
    case "email": return (
      <div className="rounded-[14px] border border-line bg-paper p-4">
        <p className="text-sm"><b>Subject:</b> {p.subject}</p>
        <p className="mt-1 text-xs text-sub">TEST sample data. Same builder as every real send. Links are disabled in this preview.</p>
        <iframe title={`${p.subject} preview`} srcDoc={p.html} sandbox="" className="mt-3 h-[70vh] min-h-[480px] w-full rounded-[10px] border border-line bg-paper" />
      </div>
    );
    case "text": return <Texts variants={[{ label: "Text message", body: p.body }]} />;
    case "texts": return <Texts variants={p.variants} />;
    case "doc": return (
      <div className="rounded-[14px] border border-line bg-paper p-4">
        <h3 className="font-semibold">{p.title}</h3>
        {p.note && <p className="mt-1 text-xs text-sub">{p.note}</p>}
        <pre className="mt-3 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-[10px] bg-mist p-3 font-sans text-sm">{p.body}</pre>
      </div>
    );
    case "questions": return (
      <div className="rounded-[14px] border border-line bg-paper p-4">
        <h3 className="font-semibold">{p.title}</h3>
        <p className="mt-1 text-xs text-sub">The questions the portal reads from this form. Record: {p.record}</p>
        {p.groups.map((g) => (
          <div key={g.heading} className="mt-3">
            <p className="text-[11px] font-bold uppercase text-sub">{g.heading}</p>
            <ol className="mt-1 divide-y divide-line">{g.items.map((q, i) => <li key={i} className="py-1.5 text-sm"><span>{q.label}</span> <span className="text-xs text-sub">· {q.type}{q.note ? ` · ${q.note}` : ""}</span></li>)}</ol>
          </div>
        ))}
      </div>
    );
    case "table": return (
      <div className="overflow-x-auto rounded-[14px] border border-line bg-paper p-4">
        <h3 className="font-semibold">{p.title}</h3>
        {p.note && <p className="mt-1 text-xs text-sub">{p.note}</p>}
        <table className="mt-3 w-full text-left text-sm">
          <thead><tr>{p.columns.map((c) => <th key={c} className="border-b border-line py-1.5 pr-3 text-xs font-bold text-sub">{c}</th>)}</tr></thead>
          <tbody>{p.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-line py-1.5 pr-3 align-top">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    case "file": return <PageFile path={p.path} note={p.note} />;
    case "files": return (
      <div className="rounded-[14px] border border-line bg-paper p-4">
        <ul className="divide-y divide-line">{p.items.map((f) => <li key={f.label} className="py-2 text-sm"><DocLink path={f.path} label={f.label} /><p className="text-xs text-sub">{f.note}</p></li>)}</ul>
      </div>
    );
  }
}

function Texts({ variants }: { variants: { label: string; body: string }[] }) {
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4">
      <p className="text-xs text-sub">TEST sample data. Same wording function as every real text; the brand line is added exactly as sent.</p>
      <div className="mt-3 space-y-3">
        {variants.map((v) => (
          <div key={v.label}>
            {variants.length > 1 && <p className="text-[11px] font-bold uppercase text-sub">{v.label}</p>}
            <p className="mt-1 max-w-[420px] whitespace-pre-wrap rounded-[16px] rounded-bl-[4px] bg-mist px-3 py-2 text-sm">{v.body}</p>
            <p className="mt-0.5 text-[11px] text-sub">{v.body.length} characters</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageFile({ path, note }: { path: string; note: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const load = PAGE_FILES[`/${path}`];
  useEffect(() => { let live = true; if (load) void load().then((h) => { if (live) setHtml(h); }); return () => { live = false; }; }, [load]);
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4">
      <p className="text-xs text-sub">{note}</p>
      {!load ? <p className="mt-2 text-sm text-rose">Design file not found: {path}</p>
        : html === null ? <p className="mt-2 text-sm text-sub">Loading…</p>
        : <iframe title={`${path} preview`} srcDoc={html} sandbox="" className="mt-3 h-[75vh] min-h-[520px] w-full max-w-[460px] rounded-[10px] border border-line bg-paper" />}
    </div>
  );
}

function DocLink({ path, label }: { path: string | null; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const load = path ? DOC_FILES[`/${path}`] : undefined;
  useEffect(() => { let live = true; if (load) void load().then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [load]);
  if (!load) return <span className="font-semibold">{label} <Pill tone="rose">Not on file</Pill></span>;
  return url ? <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-hiv-blue hover:underline">{label}<ArrowUpRight className="h-4 w-4" /></a> : <span className="font-semibold">{label}</span>;
}

type CatalogueDoc = { key: string; version: string; status: string; approvedBy: string | null; approvedAt: string | null };
function PaperworkApproval({ docKey }: { docKey: string }) {
  const load = useServerFn(paperworkCatalogueFn);
  const q = useQuery({ queryKey: ["paperwork-catalogue"], queryFn: () => load() });
  const d = ((q.data?.docs ?? []) as CatalogueDoc[]).find((x) => x.key === docKey);
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-sub">Stored approval:</span>
      {q.isError ? <span className="text-rose">could not load</span> : q.isLoading ? <span className="text-sub">loading…</span> : d ? <><Pill tone={d.status === "Approved" ? "green" : "rose"}>{d.status}</Pill><span className="text-xs text-sub">{d.version}{d.approvedBy ? ` · ${d.approvedBy}` : ""}{d.approvedAt ? `, ${d.approvedAt.slice(0, 10)}` : ""}</span></> : <span className="text-sub">not recorded</span>}
      <Link to="/admin/settings" search={{ tab: "templates" }} className="text-xs font-semibold text-hiv-blue hover:underline">Settings › Owner paperwork</Link>
    </p>
  );
}

function MittiConnection({ formKey }: { formKey: FormKey }) {
  const get = useServerFn(getMittiForms);
  const q = useQuery({ queryKey: ["mitti_forms"], queryFn: () => get() });
  const id = q.data?.[formKey] ?? null;
  return (
    <div className="space-y-3">
      <p className="rounded-[14px] border border-line bg-paper p-4 text-sm"><span className="text-sub">Saved Mitti form: </span>{q.isError ? <span className="text-rose">settings could not load</span> : q.isLoading ? "loading…" : id ? <span className="break-all">{id}</span> : "no form ID saved"}</p>
      {q.data && <MittiFormCard formKey={formKey} connected={id} />}
    </div>
  );
}
