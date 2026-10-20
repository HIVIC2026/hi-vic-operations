import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { createSupabaseClient } from "@/integrations/supabase/client";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

const searchSchema = z.object({ token_hash: z.string().min(20).optional(), type: z.literal("magiclink").optional(), next: z.string().regex(/^\/(?![\/\\])/, "same-site path only").catch("/home").default("/home") });

export const Route = createFileRoute("/qa-access")({
  validateSearch: (search) => searchSchema.parse(search),
  component: QaAccess,
});

function QaAccess() {
  const { token_hash, next } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token_hash) { setError("This TEST access link is incomplete."); return; }
    const storageKey = `hivic-qa-${token_hash.slice(0, 12)}`;
    const qaClient = createSupabaseClient({ storageKey });
    void qaClient.auth.verifyOtp({ token_hash, type: "magiclink" }).then(async ({ data, error: authError }) => {
      if (authError || data.user?.user_metadata?.["qa_test"] !== true || !data.user.email?.endsWith("@hivic-test.example")) {
        const { error: signOutError } = await qaClient.auth.signOut();
        setError(signOutError?.message ?? authError?.message ?? "This is not an approved TEST account.");
        return;
      }
      if (!data.session) { setError("The TEST session could not be started."); return; }
      sessionStorage.setItem("hivic-qa-auth-storage-key", storageKey);
      window.location.replace(next);
    }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "The TEST session could not be started."));
  }, [next, token_hash]);
  return <main className="grid min-h-screen place-items-center bg-background p-6"><div className="max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm"><img src={logo.url} alt="Home Insulation Victoria" className="mx-auto h-12 w-auto" /><h1 className="mt-4 font-display text-xl font-bold">Opening TEST role</h1><p className="mt-2 text-sm text-muted-foreground">{error ?? "Checking this one-time link…"}</p></div></main>;
}