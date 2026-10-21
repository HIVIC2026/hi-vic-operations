// Electrician allocation, job-only contact sharing and rectification review cards.
import { RectWindowsSummary } from "./rectification-times";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/portal/panels";
import { Pill } from "@/components/portal/badges";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { getVisitContacts, listRecCandidates, releaseInstallContacts, reviewRectificationQuote, sendRectificationQuote, startPiesaOffers } from "@/lib/allocation.functions";

const VISIT: Record<string, string> = { ready_check: "Ready Check", piesa: "Pre Insulation Electrical Safety Assessment (PIESA) visit", rectification: "electrical fixes", installation: "Installation" };

/** Office: PIESA allocation, rectification quote review/send, installation contact release. */
export function OfficeAllocationPanel({ jobId }: { jobId: string }) {
  const listFn = useServerFn(listRecCandidates);
  const start = useAction(startPiesaOffers);
  const review = useAction(reviewRectificationQuote);
  const send = useAction(sendRectificationQuote);
  const release = useAction(releaseInstallContacts);
  const offers = useQuery({ queryKey: ["rec-offers", jobId], queryFn: async () => (await supabase.from("partner_offers").select("id, kind, status, batch, expires_at, businesses(name)").eq("job_id", jobId).in("kind", ["piesa", "rectification"]).order("offered_at", { ascending: false })).data ?? [] });
  const cands = useQuery({ queryKey: ["rec-cands", jobId], queryFn: () => listFn({ data: { jobId } }), enabled: false });
  const rect = useQuery({ queryKey: ["rect-draft", jobId], queryFn: async () => (await supabase.from("quotes").select("id, status, office_reviewed_at, customer_total_inc_gst").eq("job_id", jobId).eq("kind", "rectification").eq("status", "draft").maybeSingle()).data });
  const reason = useReasonDialog();
  const refresh = () => { offers.refetch(); rect.refetch(); };
  return (
    <Section title="Electrician allocation and visit contacts">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={async () => { await start({ jobId }, "PIESA offers sent to approved electricians"); refresh(); }}>Offer PIESA to approved electricians</Button>
          <Button size="sm" variant="outline" onClick={async () => { const r = await reason.ask({ title: "Offer with rate to be confirmed", description: "Electricians will see \"Rate to be confirmed\". A reason is required and audited.", placeholder: "Reason for offering without a recorded electrician rate? (required — electricians will see \"Rate to be confirmed\")", minLength: 5 }); if (!r) return; await start({ jobId, rateToConfirm: true, reason: r }, "PIESA offered with rate to be confirmed"); refresh(); }}>Offer with rate to be confirmed</Button>
          <Button size="sm" variant="outline" onClick={() => cands.refetch()}>Show matching electricians</Button>
          <Button size="sm" variant="outline" onClick={async () => { await release({ jobId }, "Installation contacts shared with the agreed installer"); }}>Share installation contacts</Button>
        </div>
        <p className="text-xs text-muted-foreground">Offers start only after the PIESA gate is satisfied. Electricians without a recorded agreed rate are skipped unless you choose rate to be confirmed. Contacts are shared for the active visit only; sharing contacts is not a booking.</p>
        {cands.data && <ul className="space-y-1">{cands.data.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.name}{c.preferred ? " (preferred)" : ""}</span><span className="text-xs text-muted-foreground">{c.blocker ?? `Eligible · order ${(c.rank ?? 0) + 1}`}</span></li>)}</ul>}
        {!!offers.data?.length && <ul className="space-y-1">{offers.data.map((o) => <li key={o.id} className="flex justify-between gap-2"><span>{(o.businesses as { name: string } | null)?.name} · {o.kind} · batch {o.batch}</span><Pill t={o.status === "accepted" ? "good" : o.status === "pending" ? "info" : "bad"}>{o.status}</Pill></li>)}</ul>}
        {rect.data && (
          <div className="rounded-lg border p-3">
            <div className="font-semibold">Draft electrical fixes quote — office review required before the owner sees it</div>
            <RectWindowsSummary jobId={jobId} />
            <div className="mt-2 flex gap-2">
              {!rect.data.office_reviewed_at
                ? <Button size="sm" onClick={async () => { await review({ quoteId: rect.data!.id }, "Marked reviewed"); refresh(); }}>Mark reviewed</Button>
                : <Button size="sm" onClick={async () => { await send({ quoteId: rect.data!.id }, "Sent to owner for approval"); refresh(); }}>Send to owner for approval</Button>}
            </div>
          </div>
        )}
      </div>
      {reason.dialog}
    </Section>
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
