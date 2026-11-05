import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BizPage } from "@/components/trade/business-pages";
import { card, greenBtn } from "@/components/trade/TradeShell";
import { getTradeBusiness, setTradeWhoBooks } from "@/lib/trade-view.functions";
import { BUSINESS_WORDS, WHO_BOOKS_LABEL, WHO_BOOKS_QUESTION, type WhoBooks } from "@/lib/business-screen.core";
import { readableError } from "@/lib/readable-error.core";
import { InstallerElectricians } from "@/components/portal/installer-electricians";

export const Route = createFileRoute("/_authenticated/field/business_/electrician")({
  head: () => ({ meta: [{ title: "Electricians – Home Insulation Victoria" }, { name: "description", content: "Your electricians and who books the safety check." }, { property: "og:title", content: "Electricians – Home Insulation Victoria" }, { property: "og:description", content: "Your electricians and who books the safety check." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Electricians,
});

/** Installer screens Task 9 + Jo 5 Nov 2026: the ONE Electricians list (add / remove a linked electrician business, one
 *  Main) and the who-books setting Part 6 reads per job. Team electricians are added on the Team page. */
function Electricians() {
  const qc = useQueryClient();
  const load = useServerFn(getTradeBusiness);
  const save = useServerFn(setTradeWhoBooks);
  const { data, refetch } = useQuery({ queryKey: ["trade-business"], queryFn: () => load(), staleTime: 30_000 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screen = data?.screen ?? null;
  return (
    <BizPage title={BUSINESS_WORDS.rows.electricians}>
      {(d) => d.kind !== "installer" ? <p className={`${card} text-sm`}>Only installer businesses have this page.</p> : (<>
        {/* Jo 5 Nov 2026: the ONE Electricians list — linked electrician businesses and Team electricians, one Main. */}
        <section className={card} data-team-electricians><InstallerElectricians businessId={d.businessId} canEdit={d.boss} /></section>
        <fieldset className={card} data-who-books disabled={!d.boss || busy}>
          <legend className="font-display text-[17px] font-semibold">{WHO_BOOKS_QUESTION}</legend>
          {(Object.keys(WHO_BOOKS_LABEL) as WhoBooks[]).map((k) => (
            <label key={k} className="flex min-h-12 items-center gap-3 text-[15px]">
              <input type="radio" name="who-books" value={k} checked={(screen?.whoBooks ?? "office") === k} onChange={async () => {
                setBusy(true); setNote(null); setError(null);
                try { await save({ data: { whoBooks: k } }); setNote(BUSINESS_WORDS.whoBooksSaved); await qc.invalidateQueries({ queryKey: ["trade-business"] }); await refetch(); }
                catch (e) { setError(readableError(e, "Couldn't save that. Check your connection and try again.")); }
                finally { setBusy(false); }
              }} />
              {WHO_BOOKS_LABEL[k]}
            </label>
          ))}
          {note && <p role="status" className="mt-1 text-sm text-hiv-green">{note}</p>}
          {error && <p role="alert" className="mt-1 text-sm text-rose">{error}</p>}
        </fieldset>
        <a href="/field/business/team" className={greenBtn}>Add an electrician on the Team page</a>
      </>)}
    </BizPage>
  );
}
