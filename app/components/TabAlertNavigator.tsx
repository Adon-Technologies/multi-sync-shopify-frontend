import { useState } from "react";

import styles from "../styles/tab-alert-navigator.module.css";

export interface TabAlert {
  actionLabel?: string;
  actionLoading?: boolean;
  heading: string;
  id: string;
  message?: string;
  onAction?: () => void;
  tone: "critical" | "warning";
}

interface TabAlertNavigatorProps {
  alerts: TabAlert[];
}

export function TabAlertNavigator({ alerts }: TabAlertNavigatorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (alerts.length === 0) {
    return null;
  }

  const selectedIndex = alerts.findIndex(({ id }) => id === selectedId);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const currentAlert = alerts[currentIndex];
  const hasMultipleAlerts = alerts.length > 1;

  const selectPrevious = () => {
    const previousIndex =
      (currentIndex - 1 + alerts.length) % alerts.length;
    setSelectedId(alerts[previousIndex].id);
  };
  const selectNext = () => {
    setSelectedId(alerts[(currentIndex + 1) % alerts.length].id);
  };

  return (
    <s-banner heading={currentAlert.heading} tone={currentAlert.tone}>
      {currentAlert.message ? (
        <s-paragraph>{currentAlert.message}</s-paragraph>
      ) : null}

      {currentAlert.onAction || hasMultipleAlerts ? (
        <div className={styles.controls}>
          {currentAlert.onAction ? (
            <s-button
              loading={currentAlert.actionLoading ? true : undefined}
              onClick={currentAlert.onAction}
              variant="secondary"
            >
              {currentAlert.actionLabel ?? "Try again"}
            </s-button>
          ) : null}

          {hasMultipleAlerts ? (
            <>
              <span
                aria-live="polite"
                className={styles.position}
                role="status"
              >
                Alert {currentIndex + 1} of {alerts.length}
              </span>
              <s-button
                accessibilityLabel="Show previous alert"
                onClick={selectPrevious}
                variant="secondary"
              >
                Previous
              </s-button>
              <s-button
                accessibilityLabel="Show next alert"
                onClick={selectNext}
                variant="secondary"
              >
                Next
              </s-button>
            </>
          ) : null}
        </div>
      ) : null}
    </s-banner>
  );
}
