import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="portal-theme grid min-h-screen place-items-center bg-background px-4 py-12 text-foreground">
    <div className="w-full max-w-sm rounded-[22px] border bg-card p-6 text-center shadow-sm">
      <img src={logo.url} alt="Home Insulation Victoria" className="mx-auto mb-4 h-12 w-auto" />
      {children}
    </div>
  </main>
);

function SignOut() {
  const qc = useQueryClient();
  return <Button variant="outline" size="field" className="mt-4 w-full" onClick={async () => { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); window.location.replace("/portal"); }}>Sign out</Button>;
}

export function NoAccess({ email }: { email: string }) {
  return (
    <Shell>
      <h1 className="font-display text-xl font-bold">Your account isn't linked yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">You're signed in as <strong>{email}</strong>, but this email isn't linked to a Home Insulation Victoria portal account yet.</p>
      <p className="mt-2 text-sm">Contact Home Insulation Victoria: <a className="font-semibold text-primary underline" href="mailto:info@homeinsulationvictoria.com.au">info@homeinsulationvictoria.com.au</a></p>
      <SignOut />
    </Shell>
  );
}

/** Same email with office AND trade access (e.g. Jo): pick where to go. */
export function RoleChooser({ email }: { email: string }) {
  return (
    <Shell>
      <h1 className="font-display text-xl font-bold">Where to?</h1>
      <p className="mt-1 text-sm text-muted-foreground">{email} has office and trade access.</p>
      <div className="mt-4 grid gap-2">
        <a href="/admin/enquiries" className="flex h-12 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground">Office</a>
        <a href="/field" className="flex h-12 items-center justify-center rounded-xl border font-semibold">Trade – My work</a>
      </div>
      <SignOut />
    </Shell>
  );
}
