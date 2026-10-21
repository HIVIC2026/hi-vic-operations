import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, X } from "lucide-react";
import { getInstallerJourney } from "@/lib/installer-journey.functions";

/** Installer-led job tracker: where the job is, what's done, and only what's still missing. */
export function InstallerJourney({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerJourney);
  const { data } = useQuery({ queryKey: ["installer-journey", jobId], queryFn: () => load({ data: { jobId } }) });
  if (!data) return null;
  const { steps, currentIndex, coverage, next, carryOver } = data;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-1 text-lg font-semibold">Your customer's job</h2>
      <p className="mb-3 rounded bg-accent px-2 py-1.5 text-sm font-medium text-accent-foreground">Next: {next}</p>
      <ol className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {steps.map((s, i) => {
          const done = i < currentIndex, now = i === currentIndex;
          return (
            <li key={s.key} className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 text-xs ${now ? "border-primary bg-primary/10 font-semibold" : done ? "bg-muted/50 text-muted-foreground" : "text-muted-foreground"}`}>
              {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Circle className={`h-3.5 w-3.5 ${now ? "text-primary" : ""}`} />}{s.label}
            </li>
          );
        })}
      </ol>
      {coverage.hardFail.length > 0 && <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{coverage.hardFail.map((h) => <div key={h} className="flex gap-1.5"><X className="mt-0.5 h-4 w-4 shrink-0" />{h}</div>)}</div>}
      <h3 className="mb-1 text-sm font-semibold">Ready Check {coverage.status === "complete" ? "– everything supplied" : coverage.status === "partial" ? "– a few items still needed" : "– not supplied yet"}</h3>
      {coverage.status === "complete" ? (
        <p className="text-sm text-muted-foreground">Home Insulation Victoria will review your Ready Check. If accepted, no extra visit is needed.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{coverage.status === "none" ? "Nothing supplied yet — fill in the Ready Check form in Mitti during your visit." : "Some items are still missing. Here's where each one gets collected."}</p>
          {carryOver.beforeQuote.length > 0 && (
            <div className="rounded-[13px] border border-rose/25 bg-pink p-3">
              <p className="text-sm font-semibold">Settle these before we can quote</p>
              <ul className="mt-1 space-y-1">{carryOver.beforeQuote.map((m) => <li key={m} className="flex gap-2 text-sm"><X className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{m}</li>)}</ul>
              
            </div>
          )}
          {carryOver.atPiisa.length > 0 && (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-semibold">Bring these with the PIISA on installation day</p>
              <ul className="mt-1 space-y-1">{carryOver.atPiisa.map((m) => <li key={m} className="flex gap-2 text-sm"><Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{m}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
