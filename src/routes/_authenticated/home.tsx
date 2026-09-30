import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMe } from "@/hooks/use-me";
import { AppShell } from "@/components/portal/AppShell";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({ meta: [{ title: "Home – HI VIC Portal" }, { name: "description", content: "Your HI VIC portal home." }, { property: "og:title", content: "HI VIC Portal" }, { property: "og:description", content: "Your HI VIC portal home." }] }),
  component: Home,
});

function Home() {
  const { data: me, isLoading } = useMe();
  if (isLoading || !me) return null;
  if (me.roles.includes("admin")) return <Navigate to="/admin" search={{ tab: "enquiries" }} />;
  if (me.roles.includes("electrician") || me.roles.includes("installer")) return <Navigate to="/field" />;
  if (me.roles.includes("owner")) return <Navigate to="/owner" />;
  return (
    <AppShell>
      <div className="mx-auto max-w-md rounded-xl border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">Awaiting access</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account ({me.user.email}) is active but HI VIC hasn't assigned you a role yet. We'll be in touch.</p>
      </div>
    </AppShell>
  );
}
