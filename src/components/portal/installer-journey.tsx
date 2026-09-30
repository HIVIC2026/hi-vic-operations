import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, X } from "lucide-react";
import { getInstallerJourney } from "@/lib/installer-journey.functions";

/** Installer-led job tracker: where the job is, what's done, and only what's still missing. */
export function InstallerJourney({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerJourney);
  const { data } = useQuery({ queryKey: ["installer-journey", jobId], queryFn: () => load({ data: { jobId } }) });
  if (!data) return null;
  const { steps, currentIndex, coverage, next } = data;
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
      <h3 className="mb-1 text-sm font-semibold">Measure-up {coverage.status === "complete" ? "– everything supplied" : coverage.status === "partial" ? "– a few items still needed" : "– not supplied yet"}</h3>
      {coverage.status === "complete" ? (
        <p className="text-sm text-muted-foreground">Home Insulation Victoria will review your measure-up. If accepted, no extra visit is needed.</p>
      ) : coverage.status === "none" ? (
        <p className="text-sm text-muted-foreground">Nothing supplied yet. Upload your existing measure-up, or book the free Ready Check.</p>
      ) : (
        <ul className="space-y-1">{coverage.missing.map((m) => <li key={m} className="flex gap-2 text-sm"><X className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{m}</li>)}</ul>
      )}
    </section>
  );
}
