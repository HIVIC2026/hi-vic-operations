import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPreliminarySavePageFn, savePreliminarySpotFn } from "@/lib/email-preliminary-offer.functions";
import { PRELIMINARY_BRAND, PRELIMINARY_BUTTON, PRELIMINARY_INTRO, PRELIMINARY_NEXT_STEP, PRELIMINARY_READY_CHECK } from "@/lib/preliminary-save-spot.core";

// Owner's secure preliminary Save my spot page (no estimate). GET does nothing; the explicit
// button POST saves once. Never shows an area, price or rebate – there is no estimate for this path.
export const Route = createFileRoute("/save-spot-preliminary/$token")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Save your spot — Home Insulation Victoria" }, { name: "description", content: "Save your spot for a free Ready Check." }, { property: "og:title", content: "Save your spot — Home Insulation Victoria" }, { property: "og:description", content: "Save your spot for a free Ready Check." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: PreliminarySavePage,
});

function PreliminarySavePage() {
  const { token } = Route.useParams();
  const read = useServerFn(getPreliminarySavePageFn);
  const save = useServerFn(savePreliminarySpotFn);
  const [state, setState] = useState<"loading" | "ready" | "saved" | "unavailable">("loading");
  const [firstName, setFirstName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void read({ data: { token } }).then((p) => {
      if (!p) return setState("unavailable");
      setFirstName(p.firstName);
      setState(p.saved ? "saved" : "ready");
    }).catch(() => setState("unavailable"));
  }, [read, token]);
  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await save({ data: { token } });
      setState("saved");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const shell = (inner: React.ReactNode) => (
    <main className="estimate-brand min-h-screen bg-estimate-canvas p-8 text-estimate-navy">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="font-display text-3xl font-bold">Save your spot</h1>
        {inner}
      </div>
    </main>
  );
  if (state === "loading") return shell(<p className="mt-3" role="status">Loading…</p>);
  if (state === "unavailable") return shell(<p className="mt-3">This link isn't available. Please contact Home Insulation Victoria and we'll help.</p>);
  if (state === "saved") return shell(<><p className="mt-3 font-bold">Your spot is saved</p><p className="mt-3">You're now in our queue for a free Ready Check. We'll contact you when installer availability is confirmed in your area. There's nothing to pay now, and you're under no obligation to proceed.</p></>);
  return shell(
    <>
      <p className="mt-3 text-left">{firstName ? `Hi ${firstName},` : "Hi there,"}</p>
      <p className="mt-3 text-left">{PRELIMINARY_INTRO}</p>
      <p className="mt-3 text-left">{PRELIMINARY_NEXT_STEP}</p>
      <button type="button" className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-estimate-green px-8 font-display text-lg font-bold text-white disabled:opacity-60" disabled={busy} onClick={onSave}>
        {busy ? "Saving…" : PRELIMINARY_BUTTON}
      </button>
      {error && <p className="mt-3 text-sm" role="alert">We couldn't save your spot just now. Please try again or contact our office.</p>}
      <p className="mt-6 text-left text-sm">{PRELIMINARY_READY_CHECK}</p>
      <p className="mt-6 text-left">Thanks,<br />Jo<br />{PRELIMINARY_BRAND}</p>
    </>,
  );
}
