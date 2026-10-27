import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage<{ qa: boolean }>();
export const qaContextActive = () => scope.getStore()?.qa === true;
export function withQaContext<T>(qa: boolean, work: () => T): T { return scope.run({ qa }, work); }