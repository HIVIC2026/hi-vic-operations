import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { TradeTabs } from "@/components/portal/trade-work";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/_authenticated/partner/payments")({
  head: () => ({ meta: [{ title: "Payments – Home Insulation Victoria" }, { name: "description", content: "When you get paid for your jobs." }, { property: "og:title", content: "Payments – Home Insulation Victoria" }, { property: "og:description", content: "When you get paid for your jobs." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Payments,
});

function Payments() {
  const { data: me } = useMe();
  return (
    <AppShell>
      <div className="pb-20">
        <h1 className="font-display text-2xl font-extrabold">Payments</h1>
        <div className="mt-4 rounded-[22px] border bg-card p-5 text-sm shadow-sm">
          <p className="font-semibold">How you get paid</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Home Insulation Victoria jobs: your agreed rate within 7 days of office sign-off.</li>
            <li>Your own customers: your full quoted price within 7 days of office sign-off and the owner paying in full.</li>
            <li>Payment never waits for VEEC registration. The office marks each payment as paid.</li>
          </ul>
          <p className="mt-3 text-muted-foreground">Each job's payout date will show here once the office signs it off.</p>
        </div>
      </div>
      <TradeTabs installer={!!me?.roles.includes("installer")} />
    </AppShell>
  );
}
