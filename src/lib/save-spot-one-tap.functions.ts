import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const redeemSaveSpot = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ credential: z.string().min(80).max(600).regex(/^[A-Za-z0-9_-]+$/) }).parse(d))
  .handler(async ({ data }) => (await import("./save-spot-one-tap.server")).redeemOneTap(data.credential));