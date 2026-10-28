import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getOwnerAddressState, saveOwnerAddress, searchOwnerAddress, type OwnerAddressState } from "@/lib/address-request.functions";
import { LINK_UNAVAILABLE } from "@/lib/estimatelink.core";
import { EstimateHeader } from "@/components/portal/EstimateHeader";

// Public no-login page where a homeowner picks their full address. The token is the only credential; nothing is
// fetched during SSR. One search box and a results list — the address can only be picked, never typed in free.
export const Route = createFileRoute("/my-address/$token")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title: "Your address — Home Insulation Victoria" },
      { name: "description", content: "Give Home Insulation Victoria your full address." },
      { property: "og:title", content: "Your address — Home Insulation Victoria" },
      { property: "og:description", content: "Give us your full address." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: OwnerAddressPage,
});

type Suggestion = { id: string; label: string };
const card = "estimate-offset rounded-2xl border border-estimate-blue-soft bg-estimate-white";

function OwnerAddressPage() {
  const { token } = Route.useParams();
  const getState = useServerFn(getOwnerAddressState);
  const searchFn = useServerFn(searchOwnerAddress);
  const saveFn = useServerFn(saveOwnerAddress);
  const { data, isLoading, isError } = useQuery({ queryKey: ["owner_address", token], queryFn: () => getState({ data: { token } }) as Promise<OwnerAddressState>, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) { setResults([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = (await searchFn({ data: { token, query: q } })) as Suggestion[];
        if (live) { setResults(r); setError(null); }
      } catch (e) {
        if (!live) return;
        if (e instanceof Error && e.message === LINK_UNAVAILABLE) setUnavailable(true);
        else setError("We couldn't search right now. Please try again.");
      } finally { if (live) setSearching(false); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query, token, searchFn]);

  const pick = async (s: Suggestion) => {
    setBusy(true); setError(null);
    try {
      const r = await saveFn({ data: { token, placeId: s.id } });
      if (r.ok) setSaved(true);
      else if (r.error === LINK_UNAVAILABLE) setUnavailable(true);
      else setError(r.error);
    } catch { setError("We couldn't save that address. Please try again."); }
    finally { setBusy(false); }
  };

  const state = unavailable || isError || data?.state === "unavailable" ? "unavailable" : saved || data?.state === "answered" ? "answered" : "open";
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <EstimateHeader />
      <main className="mx-auto max-w-[760px] px-4 pb-14 sm:px-8">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : state === "unavailable" ? <div className={`${card} p-8 text-center`}><h1 className="text-xl font-bold">Link unavailable</h1><p className="mt-2 text-sm text-estimate-navy">{LINK_UNAVAILABLE}</p></div>
          : state === "answered" ? <div className={`${card} p-8 text-center`}><p role="status" className="text-lg font-bold text-estimate-navy">Thanks, your address is saved.</p></div>
          : <div className={`${card} px-5 py-7 sm:px-10 sm:py-11`}>
              <h1 className="text-2xl font-bold text-estimate-navy">What's your full address?</h1>
              <label htmlFor="owner-address" className="mt-5 block text-sm font-semibold text-estimate-navy">Start typing your address</label>
              <input id="owner-address" type="search" inputMode="search" autoComplete="off" enterKeyHint="search" value={query} disabled={busy}
                onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                className="mt-2 block min-h-12 w-full rounded-md border border-estimate-blue-soft bg-white px-4 py-3 text-base text-estimate-navy" />
              {searching && <p className="mt-3 text-sm text-estimate-navy/70">Searching…</p>}
              {results.length > 0 && <ul className="mt-3 divide-y divide-estimate-blue-soft overflow-hidden rounded-md border border-estimate-blue-soft">
                {results.map((s) => <li key={s.id}><button type="button" disabled={busy} onClick={() => pick(s)} className="block min-h-12 w-full px-4 py-3 text-left text-base text-estimate-navy hover:bg-estimate-canvas disabled:opacity-60">{s.label}</button></li>)}
              </ul>}
              {!searching && query.trim().length >= 4 && results.length === 0 && !error && <p className="mt-3 text-sm text-estimate-navy/70">No matches yet. Keep typing.</p>}
              {busy && <p className="mt-3 text-sm text-estimate-navy/70">Saving…</p>}
              {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
            </div>}
      </main>
    </div>
  );
}
