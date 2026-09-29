import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { CustomerEstimate } from "@/components/portal/estimate";
import { supabase } from "@/integrations/supabase/client";
import { step3DesignFixtures } from "@/lib/step3-design-fixtures";

export const Route = createFileRoute("/_authenticated/admin/step3-design")({
  beforeLoad: async () => {
    const { data, error } = await supabase.rpc("is_admin");
    if (error || data !== true) throw redirect({ to: "/home" });
  },
  head: () => ({ meta: [
    { title: "Step 3 Design — HI VIC Portal" },
    { name: "description", content: "Private visual review of two sample HI VIC customer estimates." },
    { property: "og:title", content: "Step 3 Design — HI VIC Portal" },
    { property: "og:description", content: "Private visual review of two sample HI VIC customer estimates." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: Step3Design,
});

function Step3Design() {
  const fixtures = step3DesignFixtures();
  if (!fixtures) return <AppShell><p>Sample location unavailable.</p></AppShell>;
  const { knownData, unknownData } = fixtures;

  return <AppShell wide>
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-foreground">Step 3 Design</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sample estimates for visual review only. These are not customer jobs.</p>
    </div>
    <div className="space-y-12">
      <section aria-labelledby="known-example" className="bg-estimate-canvas py-7 sm:py-10">
        <div className="mx-auto max-w-[840px] px-5 sm:px-8">
          <h2 id="known-example" className="mb-6 text-lg font-semibold text-foreground">134.1 m² · Existing insulation present</h2>
          <CustomerEstimate data={knownData} />
        </div>
      </section>
      <section aria-labelledby="unknown-example" className="bg-estimate-canvas py-7 sm:py-10">
        <div className="mx-auto max-w-[840px] px-5 sm:px-8">
          <h2 id="unknown-example" className="mb-6 text-lg font-semibold text-foreground">Area unknown · No existing insulation</h2>
          <CustomerEstimate data={unknownData} />
        </div>
      </section>
    </div>
  </AppShell>;
}