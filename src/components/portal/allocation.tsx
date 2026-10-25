// Rectification (electrical fixes) quote review for the office, and job-only visit contacts for owners and trades.
import { RectWindowsSummary } from "./rectification-times";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/portal/panels";
import { getFixesTimesHold, getVisitContacts, reviewRectificationQuote, sendRectificationQuote } from "@/lib/allocation.functions";

const VISIT: Record<string, string> = { ready_check: "Ready Check", piesa: "Pre Insulation Electrical Safety Assessment (PIESA) visit", rectification: "electrical fixes", installation: "Installation" };

/** Office (O2 PIESA card, decision 14): the draft electrical fixes quote is reviewed by the office, then sent to the owner
 *  for approval. The batch "Offer PIESA to approved electricians", "rate to be confirmed" batch offer and "Share
 *  installation contacts" were removed (decision 157: the office sends to ONE electrician; contacts are released on
 *  acceptance via contact_releases). */
export function OfficeFixesQuoteReview({ jobId }: { jobId: string }) {
  const review = useAction(reviewRectificationQuote);
  const send = useAction(sendRectificationQuote);
  const rect = useQuery({ queryKey: ["rect-draft", jobId], queryFn: async () => (await supabase.from("quotes").select("id, status, office_reviewed_at, customer_total_inc_gst").eq("job_id", jobId).eq("kind", "rectification").eq("status", "draft").maybeSingle()).data });
  const loadHold = useServerFn(getFixesTimesHold);
  // Decision 315: Send stays off until the electrician has given the fixes times (the owner picks one when approving).
  const hold = useQuery({ queryKey: ["fixes-times-hold", jobId], queryFn: () => loadHold({ data: { jobId } }), enabled: !!rect.data, refetchInterval: 60_000 });
  if (!rect.data) return null;
  const held = hold.data?.reason ?? null;
  return (
    <div className="rounded-[12px] border border-line p-3 text-sm">
      <div className="font-semibold">Electrical fixes quote to check — the owner sees it only after you send it</div>
      <RectWindowsSummary jobId={jobId} />
      {held && <p className="mt-2 text-sm font-medium text-rose" data-fixes-times-hold>Held · {held}</p>}
      <div className="mt-2 flex gap-2">
        {!rect.data.office_reviewed_at
          ? <Button size="sm" onClick={async () => { await review({ quoteId: rect.data!.id }, "Marked reviewed"); void rect.refetch(); }}>Mark reviewed</Button>
          : <Button size="sm" disabled={!!held || hold.isLoading} onClick={async () => { await send({ quoteId: rect.data!.id }, "Sent to owner for approval"); void rect.refetch(); }}>Send to owner for approval</Button>}
      </div>
    </div>
  );
}

/** Owner / trade: contacts for the active visit only, with the approved privacy notice. */
export function VisitContactsCard({ jobId }: { jobId: string }) {
  const fn = useServerFn(getVisitContacts);
  const q = useQuery({ queryKey: ["visit-contacts", jobId], queryFn: () => fn({ data: { jobId } }) });
  if (!q.data?.releases.length) return null;
  return (
    <Section title="Contact details for this visit">
      <p className="mb-2 text-xs text-muted-foreground">{q.data.notice}</p>
      <ul className="space-y-2 text-sm">
        {q.data.releases.map((r, i) => (
          <li key={i} className="rounded-lg border p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{VISIT[r.visit] ?? r.visit}</div>
            <div className="font-semibold">{r.business ?? r.contact}</div>
            {r.business && r.contact && <div>{r.contact}</div>}
            {r.phone && <a className="block underline" href={`tel:${r.phone}`}>{r.phone}</a>}
            {r.email && <a className="block underline" href={`mailto:${r.email}`}>{r.email}</a>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Agree a time directly, then record it in the portal. It is booked only once the other party (or Home Insulation Victoria) confirms it.</p>
    </Section>
  );
}
