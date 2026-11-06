import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";

const tokenInput = z.object({ token: z.string().max(200) });
export const getFirmQuoteRequestPageFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((data) => tokenInput.parse(data))
  .handler(async ({ data }) => (await import("./firm-quote.server")).firmQuoteRequestPage(data.token));

export const requestFirmQuoteFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((data) => tokenInput.parse(data))
  .handler(async ({ data, context }) => (await import("./firm-quote.server")).requestFirmQuoteToken(data.token, context.assessmentTestMode));