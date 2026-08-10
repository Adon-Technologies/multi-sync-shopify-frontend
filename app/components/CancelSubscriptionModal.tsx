interface CancelSubscriptionModalProps {
  billingCycleEnd: string;
  isCanceling: boolean;
  onConfirm: () => void;
}

export const CANCEL_SUBSCRIPTION_MODAL_ID = "cancel-subscription-modal";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function CancelSubscriptionModal({
  billingCycleEnd,
  isCanceling,
  onConfirm,
}: CancelSubscriptionModalProps) {
  return (
    <s-modal
      accessibilityLabel="Cancel subscription confirmation"
      heading="Cancel subscription?"
      id={CANCEL_SUBSCRIPTION_MODAL_ID}
    >
      <s-stack gap="small">
        <s-paragraph>
          Your subscription will remain active until the end of your current
          billing period. You will not be charged for another billing cycle.
        </s-paragraph>
        <s-paragraph>
          Your plan will remain active until {formatDate(billingCycleEnd)}.
        </s-paragraph>
      </s-stack>
      <s-button
        command="--hide"
        commandFor={CANCEL_SUBSCRIPTION_MODAL_ID}
        disabled={isCanceling ? true : undefined}
        loading={isCanceling ? true : undefined}
        onClick={onConfirm}
        slot="primary-action"
        tone="critical"
        variant="primary"
      >
        Cancel subscription
      </s-button>
      <s-button
        command="--hide"
        commandFor={CANCEL_SUBSCRIPTION_MODAL_ID}
        disabled={isCanceling ? true : undefined}
        slot="secondary-actions"
        variant="secondary"
      >
        Keep subscription
      </s-button>
    </s-modal>
  );
}
