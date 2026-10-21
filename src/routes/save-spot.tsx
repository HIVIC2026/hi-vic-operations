import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { redeemSaveSpot } from "@/lib/save-spot-one-tap.functions";
export const Route = createFileRoute("/save-spot")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Save your spot — Home Insulation Victoria" }, { name: "description", content: "Your secure Home Insulation Victoria spot reservation." }, { property: "og:title", content: "Save your spot — Home Insulation Victoria" }, { property: "og:description", content: "Your secure spot reservation." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: OneTap,
});
function OneTap() {
  const redeem = useServerFn(redeemSaveSpot), navigate = useNavigate();
  const started = useRef(false), [error, setError] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const credential = new URLSearchParams(window.location.hash.slice(1)).get("c") ?? "";
    // Ordinary GET/link previews never mutate; redemption is a browser POST after opening.
    void redeem({ data: { credential } }).then(({ token }) => navigate({ to: "/estimate/$token/campaign", params: { token }, replace: true })).catch(() => setError(true));
  }, [redeem, navigate]);
  return <main className="estimate-brand min-h-screen bg-estimate-canvas p-8 text-center text-estimate-navy">{error ? <><h1 className="font-display text-2xl font-bold">This link isn't available</h1><p className="mt-3">Please contact Home Insulation Victoria and we'll help.</p></> : <p role="status">Saving your spot…</p>}</main>;
}