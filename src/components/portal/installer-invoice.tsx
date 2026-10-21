import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getInstallerLedInvoice, setApFeeOverride } from "@/lib/installer-invoice.functions";
import { AP_FEE_LOCKED_MESSAGE, apFeeEditorView } from "@/lib/ap-fee.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const money = (n: number | null | undefined) => (n == null ? "Not set" : `$${n.toFixed(2)}`);

export function InstallerLedInvoicePanel({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerLedInvoice);
  const save = useServerFn(setApFeeOverride);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["installer-invoice", jobId], queryFn: () => load({ data: { jobId } }) });
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return null;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data;
  if (!d?.installerLed) return null;

  const submit = async (clear: boolean) => {
    const n = clear ? null : Number(amount);
    if (!clear && !(n != null && Number.isFinite(n) && n >= 0)) return toast.error("Enter a valid amount.");
    if (reason.trim().length < 3) return toast.error("A reason is required.");
    setBusy(true);
    try {
      await save({ data: { jobId, amount: n, reason } });
      setAmount(""); setReason("");
      await qc.invalidateQueries({ queryKey: ["installer-invoice", jobId] });
      toast.success(clear ? "AP fee reset to standard" : "AP fee updated");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
    return undefined;
  };

  const rows: [string, number | null][] = [
    ["Installer's quote", d.quote ? Number(d.quote.subtotal_inc_gst) : null],
    ["Pre Insulation Electrical Safety Assessment (PIESA)", d.piesa],
    ["Home Insulation Victoria Accredited Person fee", d.apFee],
    ["Project total", d.price.total],
    ["VEU discount", -d.price.discount],
  ];
  return (
    <section className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold">Co-branded owner invoice (preview)</h3>
        <p className="text-xs text-muted-foreground">Installer branding with Home Insulation Victoria as the Accredited Person. All prices inc GST. No referral fee. Preview only — the Xero invoice is still raised by hand.</p>
      </div>
      <dl className="divide-y text-sm">
        {rows.map(([l, v]) => (<div key={l} className="flex justify-between py-1.5"><dt>{l}</dt><dd className="tabular-nums">{money(v)}</dd></div>))}
        <div className="flex justify-between py-2 font-semibold"><dt>Owner pays</dt><dd className="tabular-nums">{money(d.price.afterDiscount)}</dd></div>
      </dl>
      {d.price.blockers.length > 0 && (
        <ul className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive list-disc pl-6">
          {d.price.blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
      <div className="rounded-md border p-3 space-y-3">
        <p className="text-sm">
          AP fee: <strong>{money(d.apFee)}</strong>{" "}
          {d.override ? <span className="text-muted-foreground">(changed for this job — standard {money(d.standardApFee)}; reason: {d.override.reason})</span> : <span className="text-muted-foreground">(standard)</span>}
        </p>
        {apFeeEditorView({ canChange: d.canChangeApFee, locked: d.apFeeLocked }) === "locked" ? (
          <p className="text-sm font-medium">{AP_FEE_LOCKED_MESSAGE}</p>
        ) : d.canChangeApFee ? (
          <>
            <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
              <div><Label htmlFor="apfee">New AP fee</Label><Input id="apfee" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
              <div><Label htmlFor="apreason">Reason (required)</Label><Input id="apreason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this job has a different fee" /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => submit(false)}>Use this fee</Button>
              {d.override && <Button size="sm" variant="outline" disabled={busy} onClick={() => submit(true)}>Reset to standard</Button>}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Only the Home Insulation Victoria owner can change the Accredited Person fee. Ask them if this job needs a different fee.</p>
        )}
      </div>
    </section>
  );
}
