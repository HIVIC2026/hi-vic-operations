// Decision 328 (Jo, 25 Oct 2026): "Check my form now" on the installer's today page and job page. Runs the single-job A5
// Install day sync (server: trade-view.server tradeCheckInstallForm → install-day-confirm.server) and shows the same
// result the lead installer is texted. Presentation only; every rule is server-side.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { checkTradeInstallForm } from "@/lib/trade-view.functions";
import { QuietButton } from "@/components/trade/installer-kit";

type Result = { state: string; title: string; body: string; good: boolean; missing: string[]; texted: boolean };

export function CheckMyFormButton({ jobId, className }: { jobId: string; className?: string }) {
  const check = useServerFn(checkTradeInstallForm);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={className} data-check-my-form>
      <QuietButton disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try {
          setR(await check({ data: { jobId } }));
          void qc.invalidateQueries({ queryKey: ["trade-day-extras", jobId] });
          void qc.invalidateQueries({ queryKey: ["trade-day", jobId] });
        } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't check the form just now. Try again in a minute."); }
        finally { setBusy(false); }
      }}>{busy ? "Checking your form…" : "Check my form now"}</QuietButton>
      {r && (
        <section className={`mt-2 rounded-[14px] px-3.5 py-3 ${r.good ? "bg-mist" : "border border-line"}`} role="status" data-check-result={r.state}>
          <p className={`text-[15px] font-semibold ${r.good ? "text-hiv-green" : "text-ink"}`}>{r.title}</p>
          <p className="mt-1 text-sm leading-[1.45] text-sub">{r.body}</p>
          {r.missing.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{r.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
        </section>
      )}
      {err && <p role="alert" className="mt-2 text-sm font-semibold">{err}</p>}
    </div>
  );
}
