// Office: accept the partner's rates, or counter-offer them. Saving an offer never contacts the partner.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createRateOffer, getRateOffers, issueRateOfferCode, reissueRateOfferLink, sendRateOfferEmail } from "@/lib/rate-offer.functions";
import { OFFER_STATE_LABEL, type OfferItem } from "@/lib/rate-offer.core";

const money = (n: number) => `$${n.toFixed(2)}`;

export function RateOfferPanel({ applicationId, onActivate, showActivate = true }: { applicationId: string; onActivate: () => Promise<void>; showActivate?: boolean }) {
  const q = useQuery({ queryKey: ["rate-offers", applicationId], queryFn: () => getRateOffers({ data: { applicationId } }) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OfferItem[]>([]);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const r = q.data;
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading rates…</p>;
  if (q.error || !r) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Could not load rates."}</p>;
  const st = r.state;
  const canActivate = st.kind === "none" || st.kind === "accepted";
  const canOffer = st.kind === "none" || st.kind === "declined";
  const open = () => { setDraft(r.baseline.map((b) => ({ ...b }))); setNote(""); setEditing(true); };
  const save = async () => {
    setBusy(true);
    try {
      const res = await createRateOffer({ data: { applicationId, items: draft, note: note.trim() || undefined } });
      setLink(`${window.location.origin}${res.path}`);
      setEditing(false);
      toast.success("Counter-offer saved. Nothing was sent to the partner.");
      await q.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const offer = st.kind === "none" ? null : st.offer;
  const proposed = (offer?.response?.["proposed"] ?? {}) as unknown as Record<string, number>;
  return (
    <div className="space-y-3" data-rate-offer-panel>
      {st.kind !== "none" && <p className="rounded bg-muted p-2 text-sm font-semibold" data-offer-state={st.kind}>{OFFER_STATE_LABEL[st.kind]} (round {offer!.round})</p>}
      {offer && !editing && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Rate (inc GST)</th><th>Their figure</th><th>Our offer</th>{st.kind === "declined" && <th>They now propose</th>}</tr></thead>
          <tbody>{offer.items.map((i) => <tr key={i.code} className="border-t"><td className="py-1 pr-2">{i.description}<span className="text-xs text-muted-foreground"> / {i.display_unit ?? i.unit}</span></td><td>{money(i.partner_inc_gst)}</td><td className="font-semibold">{money(i.offer_inc_gst)}</td>{st.kind === "declined" && <td>{typeof proposed[i.code] === "number" ? money(proposed[i.code]!) : "—"}</td>}</tr>)}</tbody>
        </table>
      )}
      {st.kind === "declined" && typeof offer?.response?.["message"] === "string" && <p className="text-sm">Partner's message: “{String(offer.response["message"])}”</p>}
      {st.kind === "accepted" && <p className="text-xs text-muted-foreground">Signed by {String(offer!.response?.["signer_name"] ?? "")} ({String(offer!.response?.["signer_position"] ?? "")}) on {new Date(offer!.responded_at!).toLocaleString("en-AU")}. Activation will use these agreed rates.</p>}
      {st.kind === "waiting" && (
        <div className="space-y-2 rounded border p-2 text-sm" data-offer-waiting-tools>
          <p className="text-xs text-muted-foreground">The partner link lasts 14 days. To sign, the partner needs a 6-digit code from you (it lasts 15 minutes). Nothing is sent automatically.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const res = await reissueRateOfferLink({ data: { applicationId } }); setLink(`${window.location.origin}${res.path}`); setCode(null); toast.success("New link made. The old link no longer works."); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>Make a new link</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { setCode((await issueRateOfferCode({ data: { applicationId } })).code); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>Get signing code</Button>
          </div>
          {code && <p className="font-mono text-lg font-bold tracking-widest" data-signing-code>{code} <span className="font-sans text-xs font-normal text-muted-foreground">read this to the partner; valid 15 minutes</span></p>}
        </div>
      )}
      {link && (
        <div className="space-y-2 rounded border border-primary/40 p-2 text-sm">
          <p className="font-semibold">Partner link (shown once — copy it now)</p>
          <p className="break-all text-xs">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(link); toast.success("Link copied"); }}>Copy link for partner</Button>
            <Button size="sm" variant="outline" onClick={async () => { try { await sendRateOfferEmail({ data: { applicationId } }); } catch (e) { toast.error((e as Error).message); } }}>Send by email</Button>
          </div>
          {!r.emailEnabled && <p className="text-xs text-muted-foreground">Partner sending is switched off — "Send by email" will not send anything.</p>}
        </div>
      )}
      {editing ? (
        <div className="space-y-2 rounded border p-3" data-counter-offer-editor>
          <p className="text-sm font-semibold">Counter-offer rates (all figures inc GST)</p>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-xs text-muted-foreground">Rate</span><span className="text-xs text-muted-foreground">Their figure</span><span className="text-xs text-muted-foreground">Our offer</span>
            {draft.map((i, idx) => (
              <div key={i.code} className="contents">
                <label htmlFor={`offer-${i.code}`}>{i.description}<span className="text-xs text-muted-foreground"> / {i.display_unit ?? i.unit}</span></label>
                <span>{money(i.partner_inc_gst)}</span>
                <Input id={`offer-${i.code}`} aria-label={`Our offer for ${i.description}`} className="w-28" type="number" min={0} step="0.01" value={Number.isFinite(i.offer_inc_gst) ? i.offer_inc_gst : ""}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === idx ? { ...x, offer_inc_gst: e.target.value === "" ? NaN : Number(e.target.value) } : x)))} />
              </div>
            ))}
          </div>
          <label className="block text-sm" htmlFor="offer-note">Note to the partner (optional)</label>
          <Textarea id="offer-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <div className="flex gap-2">
            <Button disabled={busy} onClick={save}>Save counter-offer</Button>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
          <p className="text-xs text-muted-foreground">Saving records this offer and shows you a link to pass on. It does not email or text the partner, and does not activate them.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {showActivate && <Button disabled={!canActivate} onClick={onActivate}>{st.kind === "accepted" ? "Activate partner with agreed rates" : "Accept rates and activate partner"}</Button>}
          {canOffer && <Button variant="outline" onClick={open}>{st.kind === "declined" ? "Send a new counter-offer" : "Counter-offer rates"}</Button>}
        </div>
      )}
    </div>
  );
}
