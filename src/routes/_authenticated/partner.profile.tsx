import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { BusinessProfile } from "@/components/portal/business";

export const Route = createFileRoute("/_authenticated/partner/profile")({
  head: () => ({ meta: [{ title: "Business Profile – HI VIC Partner Portal" }, { name: "description", content: "Your partner business file, team, documents and onboarding checklist." }, { property: "og:title", content: "Business Profile – HI VIC Partner Portal" }, { property: "og:description", content: "Your partner business file, team, documents and onboarding checklist." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => (
    <AppShell>
      <Link to="/partner" className="mb-3 inline-block text-sm text-muted-foreground">← Partner dashboard</Link>
      <BusinessProfile isHivicAdmin={false} />
    </AppShell>
  ),
});
