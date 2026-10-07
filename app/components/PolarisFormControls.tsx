import { useEffect, useRef, type ComponentProps } from "react";

export function PolarisCheckbox({
  onChange,
  checked,
  disabled,
  ...props
}: ComponentProps<"s-checkbox">) {
  const ref = useRef<HTMLElementTagNameMap["s-checkbox"]>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.checked = Boolean(checked);
    element.disabled = Boolean(disabled);
    const change = (event: Event) => {
      if (!disabled)
        onChange?.(event as Parameters<NonNullable<typeof onChange>>[0]);
    };
    element.addEventListener("change", change);
    return () => element.removeEventListener("change", change);
  }, [onChange, checked, disabled]);
  return (
    <s-checkbox
      {...props}
      ref={ref}
      checked={checked ? true : undefined}
      disabled={disabled ? true : undefined}
    />
  );
}

export function PolarisSelect({
  onChange,
  value,
  disabled,
  ...props
}: ComponentProps<"s-select">) {
  const ref = useRef<HTMLElementTagNameMap["s-select"]>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.value = value ?? "";
    element.disabled = Boolean(disabled);
    const change = (event: Event) =>
      onChange?.(event as Parameters<NonNullable<typeof onChange>>[0]);
    element.addEventListener("change", change);
    return () => element.removeEventListener("change", change);
  }, [onChange, value, disabled]);
  return (
    <s-select
      {...props}
      value={value}
      disabled={disabled ? true : undefined}
      ref={ref}
    />
  );
}

export function PolarisChoiceList({
  onChange,
  ...props
}: ComponentProps<"s-choice-list">) {
  const ref = useRef<HTMLElementTagNameMap["s-choice-list"]>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.values = props.values ?? [];
    const change = (event: Event) =>
      onChange?.(event as Parameters<NonNullable<typeof onChange>>[0]);
    element.addEventListener("change", change);
    return () => element.removeEventListener("change", change);
  }, [onChange, props.values]);
  return <s-choice-list {...props} ref={ref} />;
}
