import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HI VIC Operating Portal – Sign in" },
      { name: "description", content: "Operating portal for HI VIC staff, electricians, installers and homeowners." },
      { property: "og:title", content: "HI VIC Operating Portal" },
      { property: "og:description", content: "Operating portal for HI VIC staff, electricians, installers and homeowners." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="grid min-h-screen place-items-center bg-brand-dark px-4 text-brand-dark-foreground">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-sidebar-primary text-xl font-extrabold text-sidebar-primary-foreground">HI</div>
        <h1 className="text-3xl font-extrabold tracking-tight">HI VIC Operating Portal</h1>
        <p className="mt-3 opacity-80">Home Insulation Victoria · operated by DC Construction Solutions. For HI VIC staff, assigned electricians and installers, and homeowners.</p>
        <Button asChild size="field" className="mt-8 bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
          <Link to="/home">Sign in to the portal</Link>
        </Button>
      </div>
    </div>
  );
}
