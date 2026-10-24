import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Eye, Send } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { threeQuestionsReminderBlast, getSpotReminderSettings, setSpotReminderSettings } from "@/lib/save-spot-reminder-blast.functions";
import { THREE_QUESTIONS_CONFIRMATION } from "@/lib/three-questions-reminder.core";

// Decision 172 (Jo, 24 Oct 2026): this page is the one-off "3 questions" reminder. The route path is unchanged so
// bookmarks keep working; the automatic 24-hour Save My Spot reminder switch stays here because this is its only control.
export const Route = createFileRoute("/_authenticated/admin/save-spot-reminder-blast")({
  head: () => ({ meta: [{ title: "3 questions reminder – Home Insulation Victoria" }, { name: "description", content: "Admin-only one-off 3 questions reminder: review and send once per enquiry." }, { property: "og:title", content: "3 questions reminder – Home Insulation Victoria" }, { property: "og:description", content: "Admin-only one-off 3 questions reminder review and send." }] }),
  component: BlastPage,
});

type Report = Awaited<ReturnType<typeof threeQuestionsReminderBlast>>;

function BlastPage() {
  const invoke = useServerFn(threeQuestionsReminderBlast);
  const getSettings = useServerFn(getSpotReminderSettings), saveSettings = useServerFn(setSpotReminderSettings);
  const settings = useQuery({ queryKey: ["spot-reminder-settings"], queryFn: () => getSettings() });
  const [report, setReport] = useState<Report | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [testJob, setTestJob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(kind: "dry" | "send" | "test") {
    setBusy(true); setError(null);
    try {
      if (kind === "dry") setReport(await invoke({ data: { dryRun: true } }));
      else if (kind === "test") setReport(await invoke({ data: { dryRun: false, testJobNumber: testJob.trim() } }));
      else {
        let more = true;
        const all: Report["results"] = [];
        while (more) {
          const next = await invoke({ data: { dryRun: false, confirmation: THREE_QUESTIONS_CONFIRMATION } });
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
    <h1 className="text-2xl font-bold">3 questions reminder (one-off)</h1>
    <p className="text-sm text-muted-foreground">Enquiries made before 23 October 2026 that have not answered the three insulation questions get the approved questions email and one text with their secure questions link. Each home is reminded once; nothing is repeated.</p>
    <div className="flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={() => run("dry")}><Eye className="mr-2 h-4 w-4" />Dry run</Button>
      {report && <span className="font-semibold">{report.recipientCount} to remind · {report.skipped.length} skipped</span>}</div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {report && <>
      {report.sendBlockers.map((b) => <p key={b} className="text-danger">{b}</p>)}
      <section className="space-y-3"><h2 className="text-lg font-bold">Sample messages</h2>{report.samples.map((s) => <article key={s.jobId} className="border-b border-border py-3"><p className="mb-1 text-sm text-muted-foreground">{s.jobNumber} · {s.email ?? "no email"} · {s.phone ?? "no mobile"}</p><p className="text-sm"><b>Email:</b> {s.subject ?? "not prepared"}</p><p className="text-sm"><b>Text:</b> Home Insulation Victoria: {s.smsBody}</p></article>)}</section>
      <section><h2 className="mb-3 text-lg font-bold">Skipped records</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">Job</th><th>Reason</th></tr></thead><tbody>{report.skipped.map((s) => <tr key={s.jobId}><td className="py-1 pr-3">{s.jobNumber ?? s.jobId}</td><td>{s.reason}</td></tr>)}</tbody></table></div></section>
      {report.results.length > 0 && <section><h2 className="text-lg font-bold">Send results</h2>{report.results.map((r) => <p key={r.jobId} className="py-2 text-sm">{r.jobNumber}: email {r.email} · text {r.sms}</p>)}</section>}
      <section className="space-y-3 border-t border-border pt-5"><label htmlFor="blast-confirm" className="block font-semibold">Type {THREE_QUESTIONS_CONFIRMATION}</label><Input id="blast-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        <Button disabled={busy || confirmation !== THREE_QUESTIONS_CONFIRMATION || report.sendBlockers.length > 0 || report.recipientCount === 0} onClick={() => run("send")}><Send className="mr-2 h-4 w-4" />{busy ? "Working…" : "Send reminders"}</Button></section>
    </>}
    <section className="space-y-2 border-t border-border pt-5"><label htmlFor="test-job" className="block font-semibold">Send a TEST copy (TEST job number only, goes to Jo's test inbox/phone)</label>
      <div className="flex flex-wrap items-center gap-2"><Input id="test-job" className="max-w-xs" placeholder="HV-1609" value={testJob} onChange={(e) => setTestJob(e.target.value)} /><Button variant="outline" disabled={busy || !/^HV-\d+$/.test(testJob.trim())} onClick={() => run("test")}>Send TEST copy</Button></div></section>
    <section className="border-t border-border pt-5">
      {settings.isError && <p role="alert" className="text-danger">Could not load the reminder switch.</p>}
      <div className="flex items-center gap-3"><Switch id="auto-reminder" checked={settings.data?.enabled ?? false} disabled={busy || !settings.data} onCheckedChange={async (enabled) => {
        setBusy(true); setError(null);
        try { await saveSettings({ data: { enabled } }); await settings.refetch(); }
        catch (e) { setError(e instanceof Error ? e.message : "Reminder switch failed"); }
        finally { setBusy(false); }
      }} /><label htmlFor="auto-reminder" className="font-semibold">Automatic 24-hour Save My Spot reminder (unchanged)</label></div>
    </section>
  </div></AppShell>;
}
