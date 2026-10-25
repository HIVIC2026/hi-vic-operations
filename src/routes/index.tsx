import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculatorPage } from "@/components/portal/public-calculator-page";
import { publicCalculatorHead } from "@/components/portal/public-calculator-head";
import { publicPageHeaders } from "@/lib/public-cache.core";

// The bare address is the public calculator — customers already have this
// link. The same calculator also answers at /calculator, and staff sign in
// at /auth (signed-in staff are bounced from /auth to /home).
// Rendered on the server without auth or data calls, so its HTML holds nothing per user and may be cached briefly.
export const Route = createFileRoute("/")({
  headers: publicPageHeaders,
  head: publicCalculatorHead,
  component: PublicCalculatorPage,
});
