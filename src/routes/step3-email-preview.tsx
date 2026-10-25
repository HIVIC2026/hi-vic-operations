import { createFileRoute, redirect } from "@tanstack/react-router";

// P1-S77: retired. This page previewed the superseded Step 3 / Save-your-spot emails; their renderers were removed
// on 24 Oct 2026. Jo's approved templates are previewed only in Templates › Email. Old links land there.
export const Route = createFileRoute("/step3-email-preview")({
  beforeLoad: () => { throw redirect({ to: "/admin/templates", search: { cat: "owner" }, replace: true }); },
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: () => null,
});
