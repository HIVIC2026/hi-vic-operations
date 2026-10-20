import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle } from "lucide-react";
import { getMyIntakeProgress, raiseSiteConditionsHold } from "@/lib/installer-quote.functions";
import { siteHoldNoteProblem } from "@/lib/site-conditions.core";
import { InstallerJourney } from "@/components/portal/installer-journey";
import type { NextAction, ProgressStep } from "@/lib/installer-progress.core";
import { Button } from "@/components/trade/trade-ui";

/** Installer-supplied (intake) jobs show current progress; other installer jobs keep the existing tracker. */
export function InstallerProgressCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getMyIntakeProgress);
  const { data, isError, isPending, isFetching, refetch } = useQuery({ queryKey: ["intake-progress", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  if (isPending) return null;
  if (isError || !data) return <section className="space-y-2"><p role="alert" className="text-sm text-sub">Couldn't load current job progress.</p><Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>Retry</Button></section>;
  if (!data.applies) return <InstallerJourney jobId={jobId} />;
  return <><ProgressView steps={data.steps} next={data.next} /><SiteConditionsCard jobId={jobId} open={data.siteHold.open} note={data.siteHold.note} /></>;
}

/** "Site conditions differ" — installer flags a mismatch; the office reviews and clears it. */
function SiteConditionsCard({ jobId, open, note }: { jobId: string; open: boolean; note: string | null }) {
  const raise = useServerFn(raiseSiteConditionsHold); const qc = useQueryClient();
  const [show, setShow] = useState(false); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (open) return <section className="mt-3 rounded-[18px] border border-line bg-paper p-4" data-site-hold="open"><h2 className="font-display text-base font-bold">Site conditions differ — on hold</h2><p className="mt-1 text-sm text-sub">{note ?? "Waiting for the office to review."} The quote and works can't continue until the office has reviewed it.</p></section>;
  return (
    <section className="mt-3 rounded-[18px] border border-line bg-paper p-4" data-site-hold="closed">
      {!show ? <Button variant="outline" onClick={() => setShow(true)}>Site conditions differ?</Button> : (
        <div className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor="site-hold-note">What is different onsite?</label>
          <textarea id="site-hold-note" className="min-h-24 w-full rounded-[12px] border border-line bg-paper p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <Button disabled={busy} onClick={async () => {
            const p = siteHoldNoteProblem(text); if (p) { setErr(p); return; }
            setBusy(true); setErr(null);
            try { await raise({ data: { jobId, note: text.trim() } }); await qc.invalidateQueries({ queryKey: ["intake-progress", jobId] }); }
            catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save. Please retry."); }
            finally { setBusy(false); }
          }}>{busy ? "Saving…" : "Ask the office to review"}</Button>
        </div>)}
    </section>
  );
}

export function ProgressView({ steps, next }: { steps: ProgressStep[]; next: NextAction }) {
  return (
    <section className="rounded-[18px] border border-line bg-paper p-4" data-intake-progress>
      <h2 className="font-display text-base font-bold">Where this job is up to</h2>
      <p className="mt-2 rounded-[13px] bg-estimate-mist px-3 py-2 text-sm" data-next-action>
        <span className="font-bold text-estimate-navy">Next{next.who ? ` — ${next.who}` : ""}: </span>{next.text}
      </p>
      <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.key} data-step={s.key} data-state={s.state} className={`flex items-start gap-1.5 rounded-[12px] border px-2 py-2 text-xs ${s.state === "current" ? "border-action bg-mint font-semibold text-ink" : s.state === "done" ? "border-line text-ink" : "border-line text-sub"}`}>
            {s.state === "done" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span><span className="block">{s.label}</span>{s.note && <span className="block font-normal text-sub">{s.note}</span>}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
