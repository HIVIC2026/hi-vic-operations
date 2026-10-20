// Real verifyStoredUpload with a fake storage client and fake fetch (no network, fake TEST paths).
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const removed: string[] = [];
let signError = false;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { storage: { from: () => ({
  createSignedUrl: async () => (signError ? { data: null, error: { message: "temporary" } } : { data: { signedUrl: "https://files.test/x" }, error: null }),
  remove: async (p: string[]) => { removed.push(...p); return { data: null, error: null }; },
}) } } }));
const { verifyStoredUpload, BAD_FILE_MESSAGE, CHECK_UNAVAILABLE_MESSAGE } = await import("../src/lib/upload-safety.server");

const realFetch = globalThis.fetch;
const PDF = new TextEncoder().encode("%PDF-1.7 test");
const setFetch = (f: () => Promise<Response>) => { globalThis.fetch = f as unknown as typeof fetch; };
beforeEach(() => { removed.length = 0; signError = false; });
afterEach(() => { globalThis.fetch = realFetch; });

test("network failure while reading: file kept, retryable error", async () => {
  setFetch(async () => { throw new TypeError("network down"); });
  await expect(verifyStoredUpload("job-files", "biz/a.pdf", "application/pdf")).rejects.toThrow(CHECK_UNAVAILABLE_MESSAGE);
  expect(removed).toEqual([]);
});
test("storage 503 or signing failure: file kept", async () => {
  setFetch(async () => new Response("busy", { status: 503 }));
  await expect(verifyStoredUpload("job-files", "biz/a.pdf", "application/pdf")).rejects.toThrow(CHECK_UNAVAILABLE_MESSAGE);
  signError = true;
  await expect(verifyStoredUpload("job-files", "biz/a.pdf", "application/pdf")).rejects.toThrow(CHECK_UNAVAILABLE_MESSAGE);
  expect(removed).toEqual([]);
});
test("retry after a transient failure succeeds on the same kept file", async () => {
  setFetch(async () => { throw new TypeError("blip"); });
  await expect(verifyStoredUpload("job-files", "biz/a.pdf", "application/pdf")).rejects.toThrow();
  setFetch(async () => new Response(PDF, { status: 206 }));
  await verifyStoredUpload("job-files", "biz/a.pdf", "application/pdf");
  expect(removed).toEqual([]);
});
test("content read and positively wrong type: deleted", async () => {
  setFetch(async () => new Response(new TextEncoder().encode("MZ not a pdf"), { status: 200 }));
  await expect(verifyStoredUpload("job-files", "biz/bad.pdf", "application/pdf")).rejects.toThrow(BAD_FILE_MESSAGE);
  expect(removed).toEqual(["biz/bad.pdf"]);
});
