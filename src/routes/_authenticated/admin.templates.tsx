import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { TemplatesHub } from "@/components/portal/template-hub";
import {
  TEMPLATE_CATEGORIES,
  parseTemplateSearch,
  type TemplateCategory,
  type TemplateStanding,
} from "@/lib/template-hub.core";

const title = "Templates — Home Insulation Victoria";
const description =
  "The one office register of approved email, Mitti form and compliance wording with its version and approval.";
export const Route = createFileRoute("/_authenticated/admin/templates")({
  // Only echo search that is actually present: injecting a default `cat` here makes the router
  // canonicalise the URL (307) and drop filters such as `standing`.
  validateSearch: (
    s: Record<string, unknown>,
  ): { cat?: TemplateCategory; t?: string; standing?: TemplateStanding } => {
    const parsed = parseTemplateSearch(s);
    const hasCat = TEMPLATE_CATEGORIES.some((c) => c.key === s["cat"]);
    return {
      ...(hasCat ? { cat: parsed.cat } : {}),
      ...(parsed.t ? { t: parsed.t } : {}),
      ...(parsed.standing ? { standing: parsed.standing } : {}),
    };
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
  const { cat, t, standing } = Route.useSearch();
  const category = cat ?? "email";
  return (
    <AppShell wide>
      <TemplatesHub cat={category} {...(standing ? { standing } : {})} {...(t ? { t } : {})} />
    </AppShell>
  );
}
