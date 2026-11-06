import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Check } from "lucide-react";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { getFirmQuoteRequestPageFn, requestFirmQuoteFn } from "@/lib/firm-quote.functions";
import { formatDueDate } from "@/lib/firm-quote.core";
import { FIRM_PAGE_COPY } from "@/lib/firm-quote-page-copy.core";

// Un-nested from the legacy /estimate/$token redirect, like the campaign one-tap page.
export const Route = createFileRoute("/estimate_/$token/firm-quote")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Your firm quote request — Home Insulation Victoria" },
    { name: "description", content: "Your request for a firm ceiling insulation quote from your photos." },
    { property: "og:title", content: "Your firm quote request — Home Insulation Victoria" },
    { property: "og:description", content: "Your request for a firm ceiling insulation quote from your photos." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" },
  ] }),
  component: FirmQuoteRequestPage,
});

function FirmQuoteRequestPage() {
  const { token } = Route.useParams();
  const read = useServerFn(getFirmQuoteRequestPageFn);
  const request = useServerFn(requestFirmQuoteFn);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved" | "unavailable" | "error">("loading");
  const [first, setFirst] = useState<string | null>(null);
  const [dueBy, setDueBy] = useState<string | null>(null);
  const fired = useRef(false);
  useEffect(() => {
    let active = true;
    fired.current = false;
    setState("loading");
    void read({ data: { token } }).then((r) => {
      if (!active) return;
      setFirst(r.firstName);
      // Already asked: the same confirmation straight away, nothing saved again.
      if (r.available && r.dueBy) { setDueBy(r.dueBy); setState("saved"); return; }
      setState(r.available ? "ready" : "unavailable");
    }).catch(() => { if (active) setState("unavailable"); });
    return () => { active = false; };
  }, [token, read]);
  const proceed = async () => {
    if (fired.current) return;
    fired.current = true; setState("saving");
    try {
      const result = await request({ data: { token } });
      if (!result.ok) { setState("unavailable"); return; }
      setFirst(result.firstName ?? first); setDueBy(result.dueBy); setState("saved");
    } catch { fired.current = false; setState("error"); }
  };
  // Jo (7 Nov, option B): only the "Confirm my firm quote request" button saves — page load or any other tap never
  // records a request, so email link-checkers can't save one.
  const saved = state === "saved" && !!dueBy;
  return <div className={`estimate-brand min-h-screen bg-estimate-canvas text-estimate-navy${saved ? " firm-thanks" : ""}`}>
    <main className="mx-auto max-w-[560px] px-4 pb-14 pt-8 sm:px-8">
      <header className="flex justify-center">
        <img src={CUSTOMER_BRAND.logoUrl} alt="Home Insulation Victoria" className="h-16 w-auto" />
      </header>
      {saved ? <div role="status" className="mt-8">
        <h1 className="text-center font-display text-[32px] font-extrabold leading-[1.15] sm:text-4xl">{FIRM_PAGE_COPY.thanks(first)}</h1>
        <ul className="mt-6 space-y-4 rounded-[22px] border border-estimate-line bg-estimate-white p-5 text-[15px] leading-relaxed sm:p-6">
          <Tick>{FIRM_PAGE_COPY.assessment}</Tick>
          <Tick>{FIRM_PAGE_COPY.emailBy} <strong>{formatDueDate(dueBy!)}</strong>.</Tick>
          <Tick>{FIRM_PAGE_COPY.nothingLocked}</Tick>
        </ul>
        <p className="mt-6 text-center text-xs text-estimate-navy/70">{FIRM_PAGE_COPY.footer}</p>
      </div>
      : <section className="estimate-offset mt-6 rounded-[22px] border border-estimate-blue-soft bg-white p-6 text-center shadow-[0_18px_50px_rgba(34,55,107,0.09)] sm:p-8">
        <OwnerHouse level={1} size="sm" className="mx-auto" />
        <h1 className="mt-4 font-display text-3xl font-extrabold">Your firm quote</h1>
        {state === "loading" ? <p role="status" className="mt-4">Loading…</p>
        : state === "ready" || state === "saving" || state === "error" ? <>{state === "error" && <p role="alert" className="mt-4">We couldn't save your request just now. Please try again.</p>}<button type="button" disabled={state === "saving"} aria-busy={state === "saving"} onClick={() => void proceed()} className="mt-6 flex min-h-14 w-full items-center justify-center rounded-full bg-estimate-green px-5 py-3 text-center font-display text-lg font-bold text-estimate-canvas disabled:opacity-60">{FIRM_PAGE_COPY.confirmButton}</button></>
        : <p className="mt-4">This one's already been taken care of. <a className="underline" href="mailto:info@homeinsulationvictoria.com.au">Email us</a> if something's not right.</p>}
      </section>}
    </main>
  </div>;
}

function Tick({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-3">
    <Check aria-hidden className="mt-1 h-5 w-5 shrink-0 text-estimate-green" strokeWidth={3} />
    <span>{children}</span>
  </li>;
}
