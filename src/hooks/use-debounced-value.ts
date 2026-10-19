import { useEffect, useState } from "react";

/**
 * Debounce for search boxes (~300 ms) so typing one request per pause instead of one per
 * keystroke. The value returned is what should drive the server request.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}