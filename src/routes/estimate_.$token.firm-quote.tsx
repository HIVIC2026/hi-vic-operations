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
import { ONE_TAP_SAVE_EVENTS, shouldFireOneTapSave } from "@/lib/one-tap-save.core";

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
  // One tap from the email button: armed on load, saved once on the first real tap or key press (link scanners never
  // tap, so page load alone never records a request). No second button on the page.
  useEffect(() => {
    if (state !== "ready" && state !== "error") return;
    const onInteract = (event: Event) => {
      if (!shouldFireOneTapSave({ armed: true, alreadyFired: fired.current, eventIsTrusted: event.isTrusted, eventType: event.type, target: event.target as Element | null })) return;
      void proceed();
    };
    for (const name of ONE_TAP_SAVE_EVENTS) window.addEventListener(name, onInteract, { passive: true });
    return () => { for (const name of ONE_TAP_SAVE_EVENTS) window.removeEventListener(name, onInteract); };
  }, [state, token, request]);
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
        {state === "loading" || state === "saving" ? <p role="status" className="mt-4">{state === "loading" ? "Loading…" : "Saving your request…"}</p>
        : state === "unavailable" ? <p className="mt-4">This one's already been taken care of. <a className="underline" href="mailto:info@homeinsulationvictoria.com.au">Email us</a> if something's not right.</p>
        : state === "error" ? <p role="alert" className="mt-4">We couldn't save your request just now. Please try again.</p>
        : null}
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
