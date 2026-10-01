import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Home Insulation Victoria Operations – Sign in" },
      { name: "description", content: "Sign in to Home Insulation Victoria Operations." },
      { property: "og:title", content: "Home Insulation Victoria Operations" },
      { property: "og:description", content: "Sign in to Home Insulation Victoria Operations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="portal-theme relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-12 text-foreground">
      <div className="absolute inset-x-0 top-0 h-3 bg-workspace-blush-strong" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 h-2 bg-workspace-sun-strong" aria-hidden="true" />
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-8 inline-flex rounded-lg border bg-card px-6 py-4 shadow-sm"><img src={logo.url} alt="Home Insulation Victoria" className="h-16 w-auto" /></div>
        <h1 className="font-display text-4xl font-bold text-foreground sm:text-5xl">Home Insulation Victoria <span className="mt-2 block text-xl font-semibold text-primary">Operations portal</span></h1>
        <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-muted-foreground">For Home Insulation Victoria staff, assigned electricians, installers and homeowners.</p>
        <Button asChild size="field" className="mt-8 min-w-48">
          <Link to="/home">Sign in to the portal</Link>
        </Button>
      </div>
    </main>
  );
}
