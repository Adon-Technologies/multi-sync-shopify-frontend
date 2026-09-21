import { useEffect, type RefObject } from "react";

/** React 18 does not bind custom-element show/hide events through JSX. */
export function useOverlayEvents(
  ref: RefObject<HTMLElement>,
  {
    onHide,
    onShow,
  }: { onHide?: (event: Event) => void; onShow?: (event: Event) => void },
) {
  useEffect(() => {
    const overlay = ref.current;
    if (!overlay) return;

    if (onHide) overlay.addEventListener("hide", onHide);
    if (onShow) overlay.addEventListener("show", onShow);
    return () => {
      if (onHide) overlay.removeEventListener("hide", onHide);
      if (onShow) overlay.removeEventListener("show", onShow);
    };
  }, [ref, onHide, onShow]);
}
