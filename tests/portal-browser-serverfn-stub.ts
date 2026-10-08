import { mockGate1, mockIntake, mockInternals } from "./portal-browser-stubs";
export const useServerFn = (fn: unknown) => async () => {
  const name = (fn as { __mockName?: string })?.__mockName;
  const g = globalThis as { __mockCalls?: string[]; __mockData?: Record<string, unknown> };
  if (g.__mockData) { (g.__mockCalls ??= []).push(name ?? "unknown"); if (name && name in g.__mockData) { const v = g.__mockData[name] as { __throw?: string; __delay?: number; value?: unknown } | undefined; if (v && typeof v === "object" && ("__throw" in v || "__delay" in v)) { if (v.__delay) await new Promise((r) => setTimeout(r, v.__delay)); if (v.__throw) throw new Error(v.__throw); return v.value; } return v; } }
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