import { mockInvoices } from "./portal-browser-stubs";
const read = () => {
  const g = globalThis as { __evidenceRead?: () => unknown };
  return g.__evidenceRead ? g.__evidenceRead() : { data: mockInvoices };
};
const chain: any = { data: mockInvoices, select: () => chain, eq: () => chain, order: async () => read() };
export const supabase = { storage: { from: () => ({ uploadToSignedUrl: async (path: string) => {
  const g = globalThis as { __storageUpload?: (path: string) => Promise<{ error: unknown }> };
  return g.__storageUpload ? g.__storageUpload(path) : { error: null };
} }) }, from: () => chain, auth: { getUser: async () => {
  const g = globalThis as { __stubUser?: { id: string }; __authDelay?: number };
  if (g.__authDelay) await new Promise((r) => setTimeout(r, g.__authDelay));
  return { data: { user: g.__stubUser ?? null } };
}, signOut: async () => undefined } };