import { mockInvoices } from "./portal-browser-stubs";
const chain: any = { data: mockInvoices, select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: mockInvoices }) };
export const supabase = { from: () => chain, auth: { getUser: async () => ({ data: { user: null } }), signOut: async () => undefined } };