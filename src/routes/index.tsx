import { createFileRoute, redirect } from "@tanstack/react-router";

// The bare address is the staff sign-in on every host. The public calculator
// lives at /calculator; signed-in staff are bounced from /auth to /home.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
