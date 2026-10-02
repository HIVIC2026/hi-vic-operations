import { mockGate1, mockIntake, mockInternals } from "./portal-browser-stubs";
export const useServerFn = (fn: unknown) => async () => {
  const name = (fn as { __mockName?: string })?.__mockName;
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