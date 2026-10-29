// Jo 28 Oct (decision 158, OFFICE CHOOSES): the office picks who pays for the repeat safety check; the portal's
// suggestion is shown but never decides. Plus the office "Repeat safety check price" setting.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/portal/kit";
import { chooseRepeatPiesaPayerFn, getRepeatPiesaPriceFn, recordRepeatPiesaPaidFn, repeatPiesaOfficeState, setRepeatPiesaPriceFn } from "@/lib/repeat-piesa.functions";
import { REPEAT_PAYERS, REPEAT_PAYER_LABEL, repeatOfficeHeading, type RepeatPayer } from "@/lib/repeat-piesa.core";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function RepeatPiesaPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(repeatPiesaOfficeState);
  const choose = useServerFn(chooseRepeatPiesaPayerFn);
  const paid = useServerFn(recordRepeatPiesaPaidFn);
  const { data, refetch } = useQuery({ queryKey: ["repeat-piesa", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  if (!data || data.state.stage === "none") return null;
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); await refetch(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); } };
  const s = data.state;
  return (
    <section data-testid="repeat-piesa-office" className="rounded-[14px] border border-warning bg-warning-soft p-4 text-sm">
      <p className="font-bold">{repeatOfficeHeading(s.deadline)}</p>
      {s.stage === "choose" && <>
        <p className="mt-1">Choose who pays for the repeat safety check.{data.suggestion ? ` Suggestion only: ${data.suggestion}.` : ""} Repeat safety check price: {data.price != null ? `$${data.price} inc GST` : "not set"}.</p>
        <div className="mt-3 flex flex-wrap gap-2">{REPEAT_PAYERS.map((p: RepeatPayer) => <Btn key={p} disabled={busy} onClick={() => void run(() => choose({ data: { jobId, payer: p } }))}>{REPEAT_PAYER_LABEL[p]} pays</Btn>)}</div>
      </>}
      {s.stage === "owner_accept" && <p className="mt-1">{REPEAT_PAYER_LABEL[s.payer!]} pays{s.priceIncGst != null ? ` ($${s.priceIncGst} inc GST)` : ""}. Waiting for the owner to accept on their job page.</p>}
      {s.stage === "owner_pay" && <>
        <p className="mt-1">The owner accepted. Waiting for ${s.priceIncGst} inc GST to be paid before the safety check is offered.</p>
        <div className="mt-2 flex gap-2"><input aria-label="Xero payment reference" className="h-10 flex-1 rounded-lg border px-2" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Xero payment reference" /><Btn disabled={busy || ref.trim().length < 2} onClick={() => void run(() => paid({ data: { jobId, reference: ref } }))}>Record paid</Btn></div>
      </>}
      {s.stage === "offer" && <p className="mt-1">{REPEAT_PAYER_LABEL[s.payer!]} pays · accepted · the safety check is being offered to electricians.</p>}
    </section>
  );
}

export function RepeatPiesaPriceCard() {
  const load = useServerFn(getRepeatPiesaPriceFn);
  const save = useServerFn(setRepeatPiesaPriceFn);
  const { data, refetch } = useQuery({ queryKey: ["repeat-piesa-price"], queryFn: () => load() });
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section data-why="decision 158, Jo 28 Oct" className="mt-5 rounded-[14px] border p-4 text-sm">
      <p className="font-bold">Repeat safety check price</p>
      <p className="mt-1 text-sub">What the owner pays for a repeat safety check (PIESA) when the office chooses the owner. Currently: {data?.price != null ? `$${data.price} inc GST` : "not set — owner-pays choices are refused"}.</p>
      <div className="mt-2 flex gap-2">
        <input aria-label="Repeat safety check price" inputMode="decimal" className="h-10 w-32 rounded-lg border px-2" value={v} onChange={(e) => setV(e.target.value)} placeholder="$ inc GST" />
        <Btn disabled={busy || !(Number(v) > 0)} onClick={async () => { setBusy(true); try { await save({ data: { price: Number(v) } }); setV(""); await refetch(); toast.success("Saved"); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); } }}>Save</Btn>
      </div>
    </section>
  );
}
