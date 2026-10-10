import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { FileViewerHost } from "@/components/portal/file-viewer";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { isRecoverableTransportError } from "@/lib/page-recovery.core";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <img src={logo.url} alt="Home Insulation Victoria" className="mx-auto mb-8 h-14 w-auto" />
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go home</Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const transport = isRecoverableTransportError(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <img src={logo.url} alt="Home Insulation Victoria" className="mx-auto mb-8 h-14 w-auto" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {transport ? "This page needs a refresh" : "This page didn't load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {transport
            ? "The connection dropped part-way through loading this page. Nothing has been saved or changed — refresh to pick up where you left off."
            : error instanceof Error ? error.message : String(error)}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {transport ? (
            <button onClick={() => window.location.reload()} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Refresh the page</button>
          ) : (
            <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>
          )}
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground">Go home</a>
        </div>
      </div>
    </div>
  );
}

// Runs before any page file: if the main page file itself fails to load (stale version), reload once per 30s.
const EARLY_RECOVERY = "(function(){function r(){try{var k='hiv-early-reload-at',t=+(sessionStorage.getItem(k)||0);if(Date.now()-t<30000)return;sessionStorage.setItem(k,String(Date.now()))}catch(e){}location.reload()}window.addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='SCRIPT'&&t.type==='module')r();else if(/Importing a module script failed|Failed to fetch dynamically imported module|e\\[t\\?\\?`default`\\]|reading 'default'/i.test(e.message||''))r()},true)})();";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Home Insulation Victoria Operations" },
      { name: "description", content: "Home Insulation Victoria operating portal for jobs, assessments, quotes and compliance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Open+Sans:wght@400;600;700&family=Outfit:wght@500;600;700;800&display=swap" },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <head><script dangerouslySetInnerHTML={{ __html: EARLY_RECOVERY }} /><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

// Emailed sign-in/reset links that fall back to the home page (calculator) carry tokens in the address; remember that so we can move on to the portal.
const ARRIVED_WITH_AUTH = typeof window !== "undefined" && /access_token=|[?&]code=|token_hash=|type=(magiclink|recovery|signup)/.test(window.location.hash + window.location.search);

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      const path = window.location.pathname;
      if (event === "PASSWORD_RECOVERY" && path !== "/reset-password") { window.location.replace("/reset-password?next=/portal"); return; }
      if (event === "SIGNED_IN" && ARRIVED_WITH_AUTH && (path === "/" || path === "/calculator")) { window.location.replace("/portal"); return; }
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-center" />
      <FileViewerHost />
    </QueryClientProvider>
  );
}
