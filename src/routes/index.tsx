import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculatorPage } from "@/components/portal/public-calculator-page";
import { publicCalculatorHead } from "@/components/portal/public-calculator-head";

// The bare address is the public calculator — customers already have this
// link. The same calculator also answers at /calculator, and staff sign in
// at /auth (signed-in staff are bounced from /auth to /home).
export const Route = createFileRoute("/")({
  headers: () => ({ "Cache-Control": "no-store" }),
  head: publicCalculatorHead,
  component: PublicCalculatorPage,
});
