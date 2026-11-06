import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { getFirmQuoteRequestPageFn, requestFirmQuoteFn } from "@/lib/firm-quote.functions";
import { formatDueDate } from "@/lib/firm-quote.core";
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
      setFirst(r.firstName); setState(r.available ? "ready" : "unavailable");
    }).catch(() => { if (active) setState("unavailable"); });
    return () => { active = false; };
  }, [token, read]);
  const proceed = async () => {
    if (fired.current) return;
    fired.current = true; setState("saving");
    try {
      const result = await request({ data: { token } });
      if (!result.ok) { setState("unavailable"); return; }
      setFirst(result.firstName); setDueBy(result.dueBy); setState("saved");
    } catch { fired.current = false; setState("error"); }
  };
  useEffect(() => {
    if (state !== "ready") return;
    const onInteract = (event: Event) => {
      if (!shouldFireOneTapSave({ armed: true, alreadyFired: fired.current, eventIsTrusted: event.isTrusted, eventType: event.type, target: event.target as Element | null })) return;
      void proceed();
    };
    for (const name of ONE_TAP_SAVE_EVENTS) window.addEventListener(name, onInteract, { passive: true });
    return () => { for (const name of ONE_TAP_SAVE_EVENTS) window.removeEventListener(name, onInteract); };
  }, [state, token, request]);
  return <main className="estimate-brand min-h-screen bg-estimate-canvas px-4 pb-14 pt-12 text-estimate-navy sm:px-8">
    <section className="mx-auto max-w-xl text-center">
      <OwnerHouse level={1} size="sm" className="mx-auto" />
      <h1 className="mt-5 font-display text-3xl font-bold">Your firm quote</h1>
      {state === "loading" || state === "saving" ? <p role="status" className="mt-5">{state === "loading" ? "Loading…" : "Saving your request…"}</p>
      : state === "saved" && dueBy ? <p role="status" className="mt-5 text-lg">Thanks{first ? `, ${first}` : ""}. Your firm quote is on its way by {formatDueDate(dueBy)}.</p>
      : state === "unavailable" ? <p className="mt-5">This one's already been taken care of. <a className="underline" href="mailto:info@homeinsulationvictoria.com.au">Email us</a> if something's not right.</p>
      : <><Button className="mt-6 h-12 px-6" onClick={() => void proceed()}>Proceed to firm quote</Button>
        {state === "error" && <p role="alert" className="mt-4">We couldn't save your request just now. Please try again.</p>}</>}
    </section>
  </main>;
}