import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AskToChange, BizPage, Rows } from "@/components/trade/business-pages";
import { card, greenBtn } from "@/components/trade/TradeShell";
import { uploadTradeLogo } from "@/lib/trade-view.functions";
import { BUSINESS_WORDS, LOGO_MAX_BYTES, logoFileProblem } from "@/lib/business-screen.core";
import { readableError } from "@/lib/readable-error.core";

export const Route = createFileRoute("/_authenticated/field/business_/details")({
  head: () => ({ meta: [{ title: "Business details – Home Insulation Victoria" }, { name: "description", content: "Your business details on file with Home Insulation Victoria." }, { property: "og:title", content: "Business details – Home Insulation Victoria" }, { property: "og:description", content: "Your business details on file with Home Insulation Victoria." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Details,
});

/** Named (not inline) so the route splitter puts it and LogoUpload in the lazy chunk; inline, LogoUpload's uploadTradeLogo import dragged trade-view.functions into the entry chunk. */
function Details() {
  return (
    <BizPage title="Business details" intro="What we have on file. Ask us if anything needs changing.">
      {(d, refetch) => (<>
        <Rows rows={[["Business name", d.details.name], ["Legal name", d.details.legal], ["ABN", d.details.abn], ["Phone", d.details.phone], ["Email", d.details.email], ["Address", d.details.address], ["Where you work", d.details.area], ["Usual days", d.details.days], ["Lead time", d.details.leadTime]]} />
        <AskToChange kind="details" label="Ask us to change something" placeholder="e.g. New phone number 0400 000 000, or add Werribee to our area" open={d.openRequests} onSent={refetch} />
        {d.kind === "installer" && d.boss && <LogoUpload />}
      </>)}
    </BizPage>
  );
}

/** Installer screens Task 9: the logo for co-branded quotes (boss only; PNG/JPEG ≤ 2 MB, checked here and on the server). */
function LogoUpload() {
  const upload = useServerFn(uploadTradeLogo);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={card} data-logo-upload>
      <h2 className="font-display text-[17px] font-semibold">{BUSINESS_WORDS.uploadLogo}</h2>
      <p className="mt-1 text-sm text-sub">{BUSINESS_WORDS.logoRule}</p>
      <label className={`${greenBtn} mt-3 cursor-pointer`}>
        {busy ? "Saving…" : "Choose a file"}
        <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={busy} onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          setNote(null); setError(null);
          const bytes = new Uint8Array(await f.arrayBuffer());
          const problem = f.size > LOGO_MAX_BYTES ? "The logo must be 2 MB or smaller." : logoFileProblem({ type: f.type, bytes });
          if (problem) { setError(problem); return; }
          setBusy(true);
          try {
            let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
            await upload({ data: { name: f.name, type: f.type as "image/png" | "image/jpeg", base64: btoa(bin) } });
            setNote(BUSINESS_WORDS.logoSaved);
            await qc.invalidateQueries({ queryKey: ["trade-business"] });
          } catch (err) { setError(readableError(err, "Couldn't save the logo. Check your connection and try again.")); }
          finally { setBusy(false); }
        }} />
      </label>
      {note && <p role="status" className="mt-2 text-sm text-hiv-green">{note}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-rose">{error}</p>}
    </section>
  );
}
