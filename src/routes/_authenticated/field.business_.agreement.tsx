import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { BizPage, Rows, greenBtn } from "@/components/trade/business-pages";
import { getTradeAgreementPdf } from "@/lib/trade-view.functions";
import { AGREEMENT_CHANGE_NOTE, AGREEMENT_COVERS, signedOnLine } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/business_/agreement")({
  head: () => ({ meta: [{ title: "Your agreement – Home Insulation Victoria" }, { name: "description", content: "Your signed Home Insulation Victoria partner agreement." }, { property: "og:title", content: "Your agreement – Home Insulation Victoria" }, { property: "og:description", content: "Your signed Home Insulation Victoria partner agreement." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Agreement,
});

function Agreement() {
  const pdf = useServerFn(getTradeAgreementPdf);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const w = window.open("", "_blank");
    setBusy(true);
    try {
      const r = await pdf();
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      if (w) w.location.href = url; else window.location.href = url;
    } catch (e) { w?.close(); toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <BizPage title="Your agreement" intro="Your signed Home Insulation Victoria partner agreement.">
      {(d) => d.agreement ? (<>
        {/* Approved state M7-agreement (decisions 23/171): Signed · What it covers · View the PDF · ask the office to change. */}
        <Rows rows={[["Version", `v${d.agreement.version}`], ["Signed by", d.agreement.signer], ["On", signedOnLine(d.agreement.signedAt) ?? "—"], ["Status", "In force"]]} />
        <section data-agreement-covers>
          <h2 className="border-b border-line pb-2 text-xs font-bold uppercase tracking-[1.1px] text-sub">What it covers</h2>
          <ul>{AGREEMENT_COVERS.map((c) => <li key={c} className="flex min-h-11 items-center gap-2.5 border-b border-line text-sm leading-[1.45]"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-hiv-blue" />{c}</li>)}</ul>
        </section>
        <button type="button" className={greenBtn} disabled={busy} onClick={() => void open()}>{busy ? "Opening…" : "View the PDF"}</button>
        <p className="text-[13px] text-sub">{AGREEMENT_CHANGE_NOTE}</p>
      </>) : <p className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card">There's no signed agreement on file yet. The office will send it to you to sign.</p>}
    </BizPage>
  );
}
