import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
const calls: any[] = [];
const query = { select: () => query, eq: () => query, limit: async () => ({ data: [] }) };
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => query } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async () => {} }));
mock.module("../src/lib/owner-template-send.server", () => ({ sendOwnerTemplateEmail: async (p: any) => { calls.push(p); return "not sent — test only"; } }));
const { emailOwnerYoureIn } = await import("../src/lib/approved-owner-emails.server");
test("O22 attaches Jo's loaded ESC factsheet alongside the signed acceptance", async () => {
  await emailOwnerYoureIn("job", "quote", { rebate: 500, totalIncGst: 1000, payment: null }, [{ filename: "acceptance.pdf", content: "JVBERi0=", contentType: "application/pdf" }]);
  const attachments = calls[0].attachments;
  expect(attachments.map((a: any) => a.filename)).toContain("acceptance.pdf");
  const factsheet = attachments.find((a: any) => a.filename !== "acceptance.pdf");
  expect(factsheet?.contentType).toBe("application/pdf");
  expect(Buffer.from(factsheet.content, "base64")).toEqual(readFileSync("docs/esc-forms/veu-consumer-factsheet.pdf"));
});