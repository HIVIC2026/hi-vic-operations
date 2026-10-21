import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Eye, Send } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveSpotReminderBlast } from "@/lib/save-spot-reminder-blast.functions";

export const Route = createFileRoute("/_authenticated/admin/save-spot-reminder-blast")({
  head: () => ({ meta: [{ title: "Save My Spot reminder blast – Home Insulation Victoria" }, { name: "description", content: "Admin-only one-off Save My Spot SMS reminder review and send." }, { property: "og:title", content: "Save My Spot reminder blast – Home Insulation Victoria" }, { property: "og:description", content: "Admin-only one-off Save My Spot SMS reminder review and send." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: BlastPage,
});

function BlastPage() {
  const invoke = useServerFn(saveSpotReminderBlast);
  const [report, setReport] = useState<Awaited<ReturnType<typeof saveSpotReminderBlast>> | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(dryRun: boolean) {
    setBusy(true); setError(null);
    try {
      if (dryRun) setReport(await invoke({ data: { dryRun: true } }));
      else {
        let more = true;
        const all: Array<{ jobId: string; jobNumber: string | null; status: string; detail: string }> = [];
        while (more) {
          const next = await invoke({ data: { dryRun: false, confirmation: "SEND SAVE SPOT REMINDER BLAST" } });
          all.push(...next.results); setReport({ ...next, results: [...all] });
          more = next.hasMore;
        }
        setConfirmation("");
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Reminder action failed"); }
    finally { setBusy(false); }
  }
  return <AppShell><div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
    <h1 className="text-2xl font-bold">Save My Spot reminder blast</h1>
    <div className="flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={() => run(true)}><Eye className="mr-2 h-4 w-4" />Dry run</Button>
      {report && <span className="font-semibold">{report.recipientCount} recipients · {report.skipped.length} skipped</span>}</div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {report && <>
      {report.sendBlockers.map((b) => <p key={b} className="text-danger">{b}</p>)}
      <section className="space-y-3"><h2 className="text-lg font-bold">Sample messages</h2>{report.samples.map((s) => <article key={s.jobId} className="border-b border-border py-3"><p className="mb-2 text-sm text-muted-foreground">{s.jobNumber} · {s.phone}</p><p className="break-words">{s.body}</p></article>)}</section>
      <section><h2 className="mb-3 text-lg font-bold">Skipped records</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">Job</th><th>Reason</th></tr></thead><tbody>{report.skipped.map((s) => <tr key={s.jobId} className="border-t border-border"><td className="py-2 pr-4">{s.jobNumber ?? s.jobId}</td><td>{s.reason}</td></tr>)}</tbody></table></div></section>
      {report.results.length > 0 && <section><h2 className="text-lg font-bold">Send results</h2>{report.results.map((r) => <p key={r.jobId} className="py-2 text-sm">{r.jobNumber}: {r.status} — {r.detail}</p>)}</section>}
      <section className="space-y-3 border-t border-border pt-5"><label htmlFor="blast-confirm" className="block font-semibold">Type SEND SAVE SPOT REMINDER BLAST</label><Input id="blast-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
        <Button disabled={busy || confirmation !== "SEND SAVE SPOT REMINDER BLAST" || report.sendBlockers.length > 0 || report.recipientCount === 0} onClick={() => run(false)}><Send className="mr-2 h-4 w-4" />{busy ? "Working…" : "Send reminders"}</Button></section>
    </>}
  </div></AppShell>;
}