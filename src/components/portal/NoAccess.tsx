import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function NoAccess({ email }: { email: string }) {
  const qc = useQueryClient();
  return (
    <main className="portal-theme grid min-h-screen place-items-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-sm rounded-[22px] border bg-card p-6 text-center shadow-sm">
        <h1 className="font-display text-xl font-bold">You don't have access yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">You're signed in as {email}, but this account isn't set up for the Home Insulation Victoria portal. If you think this is a mistake, please email info@homeinsulationvictoria.com.au and we'll sort it out.</p>
        <Button variant="outline" size="field" className="mt-4 w-full" onClick={async () => { await supabase.auth.signOut(); qc.clear(); window.location.assign("/portal"); }}>Sign out</Button>
      </div>
    </main>
  );
}
