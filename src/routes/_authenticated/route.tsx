import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const qa = sessionStorage.getItem("hivic-qa-session");
    if (qa) {
      try { const parsed = JSON.parse(qa) as { access_token: string; refresh_token: string }; await supabase.auth.setSession(parsed); sessionStorage.removeItem("hivic-qa-session"); }
      catch { sessionStorage.removeItem("hivic-qa-session"); }
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
