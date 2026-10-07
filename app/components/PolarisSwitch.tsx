import { useEffect, useRef } from "react";

// React 18 does not attach native `change` handlers to custom elements.
// Synchronize properties explicitly so the switch cannot display an unsaved
// value after a failed request or while initialization is in progress.
export function PolarisSwitch({
  checked,
  disabled,
  onChange,
  ...props
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  labelAccessibilityVisibility?: "visible" | "exclusive";
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLElementTagNameMap["s-switch"]>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.checked = checked;
    element.disabled = Boolean(disabled);
    const change = () => {
      const requested = element.checked;
      element.checked = checked;
      if (!disabled) onChange(requested);
    };
    element.addEventListener("change", change);
    return () => element.removeEventListener("change", change);
  }, [checked, disabled, onChange]);
  return (
    <s-switch
      {...props}
      checked={checked ? true : undefined}
      disabled={disabled ? true : undefined}
      ref={ref}
    />
  );
}
