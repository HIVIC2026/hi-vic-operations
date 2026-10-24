import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { BizPage, Rows, field, greenBtn, navyBtn } from "@/components/trade/business-pages";
import { getBankDetails, setBankDetails } from "@/lib/pilot.functions";
import { BANK_CHANGE_NOTE, bankOnFileRows } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/business_/bank")({
  head: () => ({ meta: [{ title: "Bank details – Home Insulation Victoria" }, { name: "description", content: "Where Home Insulation Victoria pays you." }, { property: "og:title", content: "Bank details – Home Insulation Victoria" }, { property: "og:description", content: "Where Home Insulation Victoria pays you." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: () => <BizPage title="Bank details" intro="Where we pay you. Only the office sees the full numbers.">{(d) => <Bank businessId={d.businessId} />}</BizPage>,
});

function Bank({ businessId }: { businessId: string }) {
  const get = useServerFn(getBankDetails);
  const save = useServerFn(setBankDetails);
  const { data, refetch, isLoading } = useQuery({ queryKey: ["trade-bank", businessId], queryFn: () => get({ data: { businessId } }) });
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ account_name: "", bsb: "", account_number: "" });
  const [busy, setBusy] = useState(false);
  if (isLoading) return <p className="text-sm">Loading…</p>;
  // Approved state M7-bank: the masked "On file" rows (never the full numbers on screen) and a guarded change.
  const onFile = bankOnFileRows(data ?? null);
  return (<>
    {onFile ? <Rows rows={onFile} /> : <p className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card">No bank details yet. Add them so we can pay you.</p>}
    {!edit ? <button type="button" className={navyBtn} onClick={() => setEdit(true)}>{data ? "Change bank details" : "Add bank details"}</button> : (
      <form className="space-y-3 rounded-[18px] border border-line bg-paper p-[19px] shadow-card" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { await save({ data: { businessId, ...f, bsb: f.bsb.replace(/\s/g, ""), account_number: f.account_number.replace(/\s/g, "") } }); toast.success("Bank details saved. The office will check them before the next payment."); setEdit(false); setF({ account_name: "", bsb: "", account_number: "" }); await refetch(); }
        catch { toast.error("Check the BSB (6 digits) and account number (5–10 digits)."); } finally { setBusy(false); }
      }}>
        <label className="block text-sm font-bold">Account name<input className={field} autoComplete="off" value={f.account_name} onChange={(e) => setF({ ...f, account_name: e.target.value })} /></label>
        <label className="block text-sm font-bold">BSB<input className={field} inputMode="numeric" placeholder="000-000" value={f.bsb} onChange={(e) => setF({ ...f, bsb: e.target.value })} /></label>
        <label className="block text-sm font-bold">Account number<input className={field} inputMode="numeric" value={f.account_number} onChange={(e) => setF({ ...f, account_number: e.target.value })} /></label>
        <button type="submit" className={greenBtn} disabled={busy || f.account_name.trim().length < 2}>Save bank details</button>
        <button type="button" className="w-full text-center text-sm font-bold text-estimate-blue" onClick={() => setEdit(false)}>Cancel</button>
        <p className="text-[13px] leading-[1.45] text-sub">{BANK_CHANGE_NOTE}</p>
      </form>
    )}
  </>);
}
