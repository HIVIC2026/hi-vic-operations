import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

/**
 * P1-R3-COM-09 (DEP-1) — public, no-login, READ-ONLY saved personal estimate.
 * The personal-estimate token is the only credential. Returns the customer's own frozen saved pricing
 * (never recalculated, never a public-calculator fallback) or null for any invalid/expired/incomplete case.
 */
export const getPersonalEstimateFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .validator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { resolvePersonalEstimate } = await import("./personal-estimate.server");
    return JSON.parse(JSON.stringify(await resolvePersonalEstimate(data.token)));
  });
