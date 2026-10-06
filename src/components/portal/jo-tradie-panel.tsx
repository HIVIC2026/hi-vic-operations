// Test Centre: run "Jo as a fake tradie" step by step. Messages only ever go to Jo (allowlist).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { joTradieAction } from "@/lib/jo-tradie.functions";

type Step = "setup" | "welcome" | "job" | "reminder" | "all_clear";
type Send = { channel: string; status: string; detail: string };

export function JoTradiePanel() {
  const run = useServerFn(joTradieAction);
  const { data, refetch } = useQuery({ queryKey: ["jo-tradie"], queryFn: () => run({ data: { step: "status" } }) });
  const [busy, setBusy] = useState<Step | null>(null);
  const st = data?.result as { business: { name: string } | null; jobs: { id: string; job_number: string; stage: string }[]; sends?: { summary: string; created_at: string }[] } | undefined;
  const job = st?.jobs[0];
  const go = async (step: Step) => {
    setBusy(step);
    try {
      const r = await run({ data: { step, jobId: job?.id } });
      const sends = (Array.isArray(r.result) ? r.result : (r.result as { sent?: Send[] }).sent) as Send[] | undefined;
      toast.success(sends ? sends.map((s) => `${s.channel}: ${s.status}${s.status !== "sent" ? ` (${s.detail})` : ""}`).join(" · ") : "Done");
      await refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <section className="mb-6 rounded-md border bg-card p-4 shadow-sm">
      <h2 className="font-display text-xl font-bold">Jo as a fake tradie</h2>
      <p className="text-sm text-muted-foreground">Texts and emails go only to Jo's mobile and email, for TEST jobs and TEST partners. Everyone else is blocked.</p>
      <p className="mt-1 text-sm">Partner: <b>{st?.business?.name ?? "not created yet"}</b>{job && <> · Latest TEST job: <b>{job.job_number}</b> ({job.stage.replaceAll("_", " ")})</>}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => go("setup")}>1a. Create + approve partner</Button>
        <Button size="sm" disabled={!!busy} onClick={() => go("welcome")}>1b. Send welcome</Button>
        <Button size="sm" disabled={!!busy} onClick={() => go("job")}>2. New TEST job + offer</Button>
        <Button size="sm" disabled={!!busy || !job} onClick={() => go("reminder")}>3. Day-before reminder</Button>
        <Button size="sm" disabled={!!busy || !job} onClick={() => go("all_clear")}>4. Simulate "All clear"</Button>
      </div>
      {!!st?.sends?.length && <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">{st.sends.map((s, i) => <li key={i}>{new Date(s.created_at).toLocaleTimeString("en-AU")} — {s.summary}</li>)}</ul>}
    </section>
  );
}
