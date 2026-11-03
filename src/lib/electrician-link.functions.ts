// The electrician's no-login job page (/e/<token>). The token is the only credential; it names one job and one
// electrician business. Everything is resolved from the token in electrician-link.server.ts, never from ids sent here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getElectricianLinkView = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100) }).parse(d))
  .handler(async ({ data }) => (await import("./electrician-link.server")).electricianLinkView(data.token));

export const bookElectricianLinkVisit = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100), kind: z.enum(["assessment", "rectification"]), start: z.string().max(40) }).parse(d))
  .handler(async ({ data }) => (await import("./electrician-link.server")).bookFromElectricianLink(data.token, data.kind, data.start));
