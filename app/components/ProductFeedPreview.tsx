import { useEffect, useRef, useState } from "react";
import { useOverlayEvents } from "../hooks/useOverlayEvents";
import { requestProductFeedPreview, type ProductFeedPreview } from "../services/feed-preview";
import styles from "../styles/diagnostics.module.css";

export interface PreviewTarget { id: string; title: string }
export function ProductFeedPreviewModal({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const [result, setResult] = useState<ProductFeedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  useOverlayEvents(modal, { onHide: (event) => { if (event.target === modal.current) onClose(); } });
  useEffect(() => {
    if (!target) { modal.current?.hideOverlay?.(); setResult(null); setError(null); setCopyState(null); return; }
    const controller = new AbortController();
    setResult(null); setError(null); setCopyState(null);
    modal.current?.showOverlay?.();
    void requestProductFeedPreview(target.id, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "XML preview couldn't be generated. Close the dialog and try again.");
    });
    return () => controller.abort();
  }, [target]);
  async function copy() {
    if (!result?.xml) return;
    try { await navigator.clipboard.writeText(result.xml); setCopyState("XML copied."); }
    catch { setCopyState("XML couldn't be copied. Select and copy the XML below."); }
  }
  function close() { modal.current?.hideOverlay?.(); onClose(); }
  return <s-modal ref={modal} id="diagnostics-xml-preview" heading="XML Preview" accessibilityLabel="Primary Feed XML Preview" size="large">
    {target ? <s-stack gap="base">
      <s-heading>{result?.productTitle ?? target.title}</s-heading>
      <s-paragraph color="subdued">Primary Feed</s-paragraph>
      {error ? <s-banner tone="critical" heading="XML preview unavailable"><s-paragraph>{error}</s-paragraph></s-banner>
        : !result ? <s-stack direction="inline" gap="small" alignItems="center"><s-spinner accessibilityLabel="Generating XML preview" /><s-text>Generating XML preview…</s-text></s-stack>
        : result.status === "not-in-feed" ? <s-banner tone="info" heading="Not included in the Primary Feed"><s-paragraph>{result.message}</s-paragraph></s-banner>
        : <div className={styles.xmlPreview} role="textbox" aria-readonly="true" aria-multiline="true" tabIndex={0} aria-label="Primary Feed XML"><pre style={{ margin: 0 }}><code>{result.xml}</code></pre></div>}
      {copyState ? <p role="status">{copyState}</p> : null}
    </s-stack> : null}
    <s-button slot="primary-action" variant="primary" disabled={!result?.xml || !target} onClick={() => void copy()}>Copy XML</s-button>
    <s-button slot="secondary-actions" variant="secondary" onClick={close}>Close</s-button>
  </s-modal>;
}
