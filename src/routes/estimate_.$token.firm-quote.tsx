import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { getFirmQuoteRequestPageFn, requestFirmQuoteFn } from "@/lib/firm-quote.functions";
import { FirmQuoteThanks } from "@/components/owner/FirmQuoteThanks";

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
  const [state, setState] = useState<"loading" | "saved" | "unavailable" | "error">("loading");
  const [first, setFirst] = useState<string | null>(null);
  const [dueBy, setDueBy] = useState<string | null>(null);
  // Token whose request this page has already tried to save (once per token, also under React's double effects).
  const firedFor = useRef<string | null>(null);
  // Jo (7 Nov, final): no button, no tap. This page only runs in a real browser (ssr: false), so a plain link fetch by
  // an email link-checker never saves; once the page's own script loads it reads the link and saves straight away.
  useEffect(() => {
    let active = true;
    setState("loading");
    void read({ data: { token } }).then(async (r) => {
      if (!active) return;
      setFirst(r.firstName);
      // Already asked: the same confirmation straight away, nothing saved again.
      if (r.available && r.dueBy) { setDueBy(r.dueBy); setState("saved"); return; }
      if (!r.available) { setState("unavailable"); return; }
      if (firedFor.current === token) return;
      firedFor.current = token;
      try {
        const result = await request({ data: { token } });
        if (!active) return;
        if (!result.ok) { setState("unavailable"); return; }
        setFirst(result.firstName ?? r.firstName); setDueBy(result.dueBy); setState("saved");
      } catch { firedFor.current = null; if (active) setState("error"); }
    }).catch(() => { if (active) setState("unavailable"); });
    return () => { active = false; };
  }, [token, read, request]);
  const saved = state === "saved" && !!dueBy;
  return <div className={`estimate-brand min-h-screen bg-estimate-canvas text-estimate-navy${saved ? " firm-thanks" : ""}`}>
    <main className="mx-auto max-w-[560px] px-4 pb-14 pt-8 sm:px-8">
      <header className="flex justify-center">
        <img src={CUSTOMER_BRAND.logoUrl} alt="Home Insulation Victoria" className="h-16 w-auto" />
      </header>
      {saved ? <FirmQuoteThanks firstName={first} dueBy={dueBy!} />
      : <section className="estimate-offset mt-6 rounded-[22px] border border-estimate-blue-soft bg-white p-6 text-center shadow-[0_18px_50px_rgba(34,55,107,0.09)] sm:p-8">
        <OwnerHouse level={1} size="sm" className="mx-auto" />
        <h1 className="mt-4 font-display text-3xl font-extrabold">Your firm quote</h1>
        {state === "loading" ? <p role="status" className="mt-4">Loading…</p>
        : state === "error" ? <p role="alert" className="mt-4">We couldn't save your request just now. Please try again.</p>
        : <p className="mt-4">This one's already been taken care of. <a className="underline" href="mailto:info@homeinsulationvictoria.com.au">Email us</a> if something's not right.</p>}
      </section>}
    </main>
  </div>;
}
