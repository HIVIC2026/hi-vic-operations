import { createFileRoute, redirect } from "@tanstack/react-router";

// Compliance Setup merged into Settings (office audit): versions + Activity 48 forms at the end of Settings › Templates,
// Mitti forms and ESC fields have their own Settings tabs. Legacy bookmark (and ?key=) kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/compliance")({
  validateSearch: (s: Record<string, unknown>): { key?: string } => (typeof s["key"] === "string" ? { key: s["key"] } : {}),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/admin/settings", search: { tab: "templates", ...(search.key ? { key: search.key } : {}) }, replace: true });
  },
  component: () => null,
});
