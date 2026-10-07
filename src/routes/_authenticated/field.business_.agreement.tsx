import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { BizPage, Rows, greenBtn } from "@/components/trade/business-pages";
import { getTradeAgreementPdf } from "@/lib/trade-view.functions";

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
    <BizPage title="Your agreement">
      {(d) => d.agreement ? (<>
        <Rows rows={[["Agreement", `Version ${d.agreement.version}`], ["Signed by", d.agreement.signer], ["Signed on", new Date(d.agreement.signedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" })]]} />
        <button type="button" className={greenBtn} disabled={busy} onClick={() => void open()}>{busy ? "Opening…" : "View the PDF"}</button>
      </>) : <p className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card">There's no signed agreement on file yet. The office will send it to you to sign.</p>}
    </BizPage>
  );
}
