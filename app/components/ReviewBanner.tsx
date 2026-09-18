import { useRef, useState, type KeyboardEvent } from "react";
import { AppProvider, Banner, BlockStack, Box, Icon, InlineStack, Text } from "@shopify/polaris";
import { StarFilledIcon, StarIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";

import { requestShopifyReview } from "../services/shopify-reviews";
import styles from "../styles/reviews.module.css";

export function PlanReviewBanner() {
  const [reviewSelection, setReviewSelection] = useState(0);
  const [requestingReview, setRequestingReview] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const reviewPending = useRef(false);
  async function requestReview(value: number) {
    if (reviewPending.current) return;
    reviewPending.current = true;
    setReviewSelection(value);
    setRequestingReview(true);
    setReviewNotice("Requesting Shopify’s review form…");
    try {
      const outcome = await requestShopifyReview();
      setReviewNotice(outcome === "not-displayed"
        ? "Shopify’s review form isn’t available right now. You can continue using Multi Sync."
        : outcome === "already-opening" ? "Continue your review in Shopify." : "");
    } finally {
      reviewPending.current = false;
      setRequestingReview(false);
    }
  }

  return <AppProvider i18n={enTranslations}>
    <Box paddingBlockStart="400" paddingBlockEnd="600">
      <Banner tone="info" title="How is your experience with Multi Sync?" stopAnnouncements>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" gap="400">
            <Text as="p" tone="subdued">Rate your experience on the Shopify App Store</Text>
            <RatingStars rating={reviewSelection} onSelect={value => void requestReview(value)}
              label="Rate your experience" disabled={requestingReview} />
          </InlineStack>
          <div role="status" aria-label="Shopify review request" aria-live="polite">{reviewNotice && <Text as="p" tone="subdued">{reviewNotice}</Text>}</div>
        </BlockStack>
      </Banner>
    </Box>
  </AppProvider>;
}

function RatingStars({ rating, onSelect, label, disabled = false }: {
  rating: number; onSelect: (value: number) => void; label: string; disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const highlighted = hover || rating;
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" || event.key === "ArrowUp" ? (index + 1) % 5
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? (index + 4) % 5
        : event.key === "Home" ? 0 : event.key === "End" ? 4 : null;
    if (next !== null) {
      event.preventDefault();
      buttons.current[next]?.focus();
    }
  }
  return <div className={styles.stars} role="group" aria-label={label} aria-busy={disabled} onMouseLeave={() => setHover(0)}>
    {[1, 2, 3, 4, 5].map(value => <button
      key={value} type="button" className={styles.star}
      aria-label={`Rate ${value} out of 5`} aria-pressed={rating === value} aria-disabled={disabled}
      data-highlighted={value <= highlighted} tabIndex={value === (rating || 1) ? 0 : -1}
      ref={element => { buttons.current[value - 1] = element; }}
      onMouseEnter={() => setHover(value)} onFocus={() => setHover(value)} onBlur={() => setHover(0)}
      onKeyDown={event => navigate(event, value - 1)} onClick={() => { if (!disabled) onSelect(value); }}
    ><Icon source={value <= highlighted ? StarFilledIcon : StarIcon} /></button>)}
  </div>;
}
