export type ProviderFanoutSource = "ebay" | "amazon";

export interface ProviderFanoutEvent {
  source: ProviderFanoutSource;
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
}

export type ProviderFanoutObserver = (event: ProviderFanoutEvent) => void;

export function safeObserveProviderFanout(
  observer: ProviderFanoutObserver | undefined,
  event: ProviderFanoutEvent
): void {
  if (!observer) return;
  try {
    observer(event);
  } catch {
    // Fan-out diagnostics must never alter provider behavior.
  }
}
