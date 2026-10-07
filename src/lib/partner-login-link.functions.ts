// Public on purpose: the 24-hour single-use token in the link is the credential. Returns no account details.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const redeemPartnerLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().min(20).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { redeemPartnerLoginLink } = await import("./set-password-link.server");
    return redeemPartnerLoginLink(data.token);
  });
