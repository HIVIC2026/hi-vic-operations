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

/** The certificate is sent as base64 text (15 MB of file is about 20 MB of text). Only the token names the job. */
export const uploadCoesByLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100), name: z.string().max(200), type: z.string().max(100), data: z.string().max(21_000_000) }).parse(d))
  .handler(async ({ data }) => (await import("./electrician-link.server")).uploadCoesFromElectricianLink(data.token, { name: data.name, type: data.type, bytes: new Uint8Array(Buffer.from(data.data, "base64")) }));

/** "Can't do this one": the token names the job and the electrician; the reason is the only other input. */
export const electricianCantDoByLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100), reason: z.string().max(480) }).parse(d))
  .handler(async ({ data }) => (await import("./electrician-link.server")).electricianCantDo(data.token, data.reason));
