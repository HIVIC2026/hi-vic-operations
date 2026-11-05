export const useServerFn = <T,>(fn: T): T => fn;
export const createMiddleware = () => ({ server: () => ({}) });
export const createServerFn = () => { throw new Error('Real server functions are prohibited in isolated QA'); };