import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { TemplatesHub } from "@/components/portal/template-hub";
import { TEMPLATE_SECTIONS, parseTemplateSearch, type TemplateSection } from "@/lib/template-hub.core";

const title = "Templates — Home Insulation Victoria";
const description =
  "Every current owner, installer, electrician and office message, Mitti form and compliance document, rendered from the live code.";
export const Route = createFileRoute("/_authenticated/admin/templates")({
  // Only echo search that is actually present: injecting a default `cat` here makes the router canonicalise the URL (307).
  // Old bookmarks (?cat=email|mitti|compliance, ?standing=…) fall back to the Owner section.
  validateSearch: (s: Record<string, unknown>): { cat?: TemplateSection; t?: string } => {
    const parsed = parseTemplateSearch(s);
    const hasCat = TEMPLATE_SECTIONS.some((c) => c.key === s["cat"]);
    return { ...(hasCat ? { cat: parsed.cat } : {}), ...(parsed.t ? { t: parsed.t } : {}) };
  },
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Page,
});

function Page() {
  const { cat, t } = Route.useSearch();
  return (
    <AppShell wide>
      <TemplatesHub cat={cat ?? "owner"} {...(t ? { t } : {})} />
    </AppShell>
  );
}
