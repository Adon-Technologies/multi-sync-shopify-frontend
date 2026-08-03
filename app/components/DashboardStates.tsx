import styles from "../styles/dashboard.module.css";

interface InlineLoadingValueProps {
  label: string;
  width?: "small" | "large";
}

export function InlineLoadingValue({
  label,
  width = "small",
}: InlineLoadingValueProps) {
  return (
    <span aria-label={label} className={styles.loadingValue} role="status">
      <span
        aria-hidden="true"
        className={`${styles.inlineSkeleton} ${
          width === "large" ? styles.inlineSkeletonLarge : ""
        }`}
      />
    </span>
  );
}
