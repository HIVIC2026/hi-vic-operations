import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { TemplatesHub } from "@/components/portal/template-hub";
import { CustomerDraftReview } from "@/components/portal/CustomerDraftReview";
import { PartnerTemplates } from "@/components/portal/PartnerTemplates";
import {
  parseTemplateSearch,
  type TemplateCategory,
  type TemplateStanding,
} from "@/lib/template-hub.core";

const title = "Templates — Home Insulation Victoria";
const description =
  "The one office register of approved email, Mitti form and compliance wording with its version and approval.";
export const Route = createFileRoute("/_authenticated/admin/templates")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { cat?: TemplateCategory; t?: string; standing?: TemplateStanding } => parseTemplateSearch(s),
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
      {category === "email" && (
        <>
          <CustomerDraftReview {...(t ? { initialKey: t } : {})} />
          <PartnerTemplates />
        </>
      )}
    </AppShell>
  );
}
