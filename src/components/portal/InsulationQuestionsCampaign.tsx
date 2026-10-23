// Jo 23 Oct 2026: "Tell us about your insulation" batch campaign. Preview first; sending refused until Jo says go.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { insulationQuestionsOverviewFn, insulationQuestionsPreviewFn, insulationQuestionsSendBatchFn } from "@/lib/launch-campaign.functions";

export function InsulationQuestionsCampaign() {
  const overview = useServerFn(insulationQuestionsOverviewFn);
  const previewFn = useServerFn(insulationQuestionsPreviewFn);
  const sendFn = useServerFn(insulationQuestionsSendBatchFn);
  const [batch, setBatch] = useState(1);
  const [preview, setPreview] = useState<{ subject: string; html: string; to: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["insulation-questions-campaign", batch], queryFn: () => overview({ data: { batch } }), staleTime: 60_000 });
  const d = q.data;
  const doPreview = async () => {
    const first = d?.rows[0];
    if (!first || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await previewFn({ data: { jobId: first.id } });
      if (r?.preview) setPreview({ subject: r.preview.subject, html: r.preview.html, to: r.preview.to });
      else setMsg(r?.detail ?? "No preview available for this owner.");
    } catch { setMsg("Could not prepare the preview."); } finally { setBusy(false); }
  };
  const doSend = async () => {
    if (!d || busy || !preview) return;
    if (!confirm(`Send batch ${batch} (${d.rows.length} owners)? Every usual check runs for each owner.`)) return;
    setBusy(true);
    try { const r = await sendFn({ data: { jobIds: d.rows.map((x) => x.id) } }); setMsg(r.refused ? r.detail : `${r.results.filter((x) => x.outcome === "sent").length} sent.`); await q.refetch(); }
    catch { setMsg("Could not send. Check communication history before retrying."); } finally { setBusy(false); }
  };
  return (
    <section aria-label="Tell us about your insulation campaign" className="space-y-3 rounded-md border bg-card p-4">
      <h2 className="font-display text-xl font-bold">“Tell us about your insulation” campaign</h2>
      {!d ? <p className="text-sm">{q.error ? "Could not load the campaign audience." : "Loading…"}</p> : (
        <>
          <p className="text-sm"><b>{d.total.toLocaleString("en-AU")}</b> owners to ask · {d.batches} batch{d.batches === 1 ? "" : "es"} of up to {d.batchSize} ({d.batchCounts.join(", ")}).</p>
          {!d.sendApproved && <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm font-semibold">Sending is off until Jo approves the final wording and says go.</p>}
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Not included ({d.exclusions.reduce((n, x) => n + x.count, 0).toLocaleString("en-AU")})</summary>
            <ul className="mt-2 space-y-1">{d.exclusions.filter((x) => x.count).map((x) => <li key={x.key}>{x.label}: <b>{x.count}</b></li>)}</ul>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">Batch <select className="h-10 rounded-md border px-2" value={batch} onChange={(e) => { setBatch(Number(e.target.value)); setPreview(null); }}>{Array.from({ length: d.batches }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
            <Button size="sm" variant="outline" disabled={busy || !d.rows.length} onClick={doPreview}>Preview email</Button>
            <Button size="sm" disabled={busy || !preview || !d.rows.length} onClick={doSend}>Send batch {batch} ({d.rows.length})</Button>
          </div>
          {msg && <p role="status" className="text-sm">{msg}</p>}
          {preview && <><p className="text-sm font-semibold">{preview.subject}</p><iframe title="Campaign email preview" sandbox="" srcDoc={preview.html} className="h-[650px] w-full border" /></>}
        </>
      )}
    </section>
  );
}
