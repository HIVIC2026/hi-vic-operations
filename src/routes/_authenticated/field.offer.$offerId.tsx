import { createFileRoute, redirect } from "@tanstack/react-router";

// Part 7 Task 9 (Jo 2 Nov 2026): the installer's job offer page (#43) is gone — nobody is offered a job any more; the
// installer calls the owner and books. Old links in texts and emails open My work. Leftover pending offers are the
// office's to close by hand (partner_offers readers on the office job page are unchanged).
export const Route = createFileRoute("/_authenticated/field/offer/$offerId")({
  beforeLoad: () => {
    throw redirect({ to: "/field" });
  },
});
