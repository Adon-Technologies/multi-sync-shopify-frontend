import { startTransition, useEffect, useState } from "react";

/**
 * Custom-element lifecycle callbacks are properties, not serializable HTML
 * attributes. Keep them out of the first client render so it matches the
 * server markup, then attach them after hydration has completed.
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    startTransition(() => setHydrated(true));
  }, []);

  return hydrated;
}
