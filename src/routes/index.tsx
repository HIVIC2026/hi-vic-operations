import { createFileRoute, redirect } from "@tanstack/react-router";
import { PublicCalculatorPage } from "@/components/portal/public-calculator-page";
import { publicCalculatorHead } from "@/components/portal/public-calculator-head";
import { publicPageHeaders } from "@/lib/public-cache.core";
import { isStaffHost } from "@/lib/staff-host.core";

// The bare address is the public calculator — customers already have this
// link. The same calculator also answers at /calculator, and staff sign in
// at /auth (signed-in staff are bounced from /auth to /home).
// Decision 381: on the staff address (portal.…) the bare address opens sign-in instead (server.ts redirects page loads).
// Rendered on the server without auth or data calls, so its HTML holds nothing per user and may be cached briefly.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && isStaffHost(window.location.hostname)) throw redirect({ to: "/auth" });
  },
  headers: publicPageHeaders,
  head: publicCalculatorHead,
  component: PublicCalculatorPage,
});
