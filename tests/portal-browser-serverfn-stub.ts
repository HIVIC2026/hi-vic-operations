import { mockGate1, mockIntake, mockInternals } from "./portal-browser-stubs";
export const useServerFn = (fn: unknown) => async () => {
  const name = (fn as { __mockName?: string })?.__mockName;
  const g = globalThis as { __mockCalls?: string[]; __mockData?: Record<string, unknown> };
  if (g.__mockData) { (g.__mockCalls ??= []).push(name ?? "unknown"); if (name && name in g.__mockData) return g.__mockData[name]; }
  if (name === "getGate1Evidence") return mockGate1;
  if (name === "getIntakeSummary") return mockIntake;
  if (name === "getInvoiceInternals") return mockInternals;
  return null;
};
export const createMiddleware = () => ({ server: () => ({}) });
export const createServerFn = () => {
  const chain = { middleware: () => chain, inputValidator: () => chain, handler: () => Object.assign(() => undefined, { __mockName: "serverFunction" }) };
  return chain;
};