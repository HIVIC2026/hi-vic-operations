import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired 7 Oct (Jo): the old "To action" list. Old bookmarks go to Needs me, which now shows everything it did.
export const Route = createFileRoute("/_authenticated/admin/todo")({
  beforeLoad: () => { throw redirect({ to: "/admin/jobs/active", replace: true }); },
  head: () => ({ meta: [
    { title: "Needs me – Home Insulation Victoria" }, { name: "description", content: "The old To action list has moved to Needs me." },
    { property: "og:title", content: "Needs me – Home Insulation Victoria" }, { property: "og:description", content: "The old To action list has moved to Needs me." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
});
