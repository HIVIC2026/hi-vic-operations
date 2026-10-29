// Decision 293: the electrician's job page shows the "A4 – Electrical fixes" Mitti form for the booked fixes visit.
// Presentation only: the form, its state and the refresh all come from fixes-day.functions. Mitti is the only way to
// record fixes done (the portal fallback form was removed).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { MittiFormLink } from "@/components/portal/MittiFormLink";
import { Button, Section } from "@/components/trade/trade-ui";
import { getFixesForm, refreshFixesForm } from "@/lib/fixes-day.functions";
import { FIXES_FORM_LINK_LABEL } from "@/lib/fixes-day.core";
import { PIESA_FULL } from "@/lib/job-wording";

export function FixesFormCard({ jobId, mittiInvited }: { jobId: string; mittiInvited: boolean }) {
  const load = useServerFn(getFixesForm);
  const refresh = useServerFn(refreshFixesForm);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["fixes-form", jobId], queryFn: () => load({ data: { jobId } }), refetchInterval: 60_000 });
  if (!data?.auditId || !mittiInvited) return null;
  const status = data.outcome === "done" ? "Complete – fixes recorded" : data.outcome === "not_done" ? "You said not all done – the office has it" : data.outcome === "held" ? "Needs the office" : "Open in Mitti";
  return (
    <Section title="Electrical fixes form (Mitti)">
      <p className="text-sm text-sub">{status}{data.detail ? ` · ${data.detail}` : ""}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MittiFormLink auditId={data.auditId} className="font-medium text-primary underline">{FIXES_FORM_LINK_LABEL}</MittiFormLink>
        {data.outcome !== "done" && (
          <Button size="field" variant="outline" disabled={busy} onClick={async () => {
            setBusy(true); setLine(null);
            try { const r = await refresh({ data: { jobId } }); setLine(r.status === "done" ? "Fixes recorded." : r.status === "waiting" ? "Not marked Complete in Mitti yet." : r.detail ?? r.status); await qc.invalidateQueries({ queryKey: ["fixes-form", jobId] }); }
            catch (e) { setLine(e instanceof Error ? e.message : "Could not read the form."); }
            finally { setBusy(false); }
          }}><RefreshCw /> Refresh from Mitti</Button>
        )}
      </div>
      {line && <p className="mt-2 text-sm text-sub">{line}</p>}
      <p className="mt-2 text-xs text-sub">Press Complete in Mitti when the repair work is done: the certificate number, date and photos go onto the {PIESA_FULL} and the owner's copy.</p>
    </Section>
  );
}
