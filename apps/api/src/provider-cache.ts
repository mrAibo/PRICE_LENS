export type ProviderCacheSource = "ebay" | "amazon";
export type ProviderCacheOutcome = "hit" | "miss" | "coalesced";

export interface ProviderCacheEvent {
  source: ProviderCacheSource;
  outcome: ProviderCacheOutcome;
}

export type ProviderCacheObserver = (event: ProviderCacheEvent) => void;

export function safeObserveProviderCache(
  observer: ProviderCacheObserver | undefined,
  event: ProviderCacheEvent
): void {
  if (!observer) return;
  try {
    observer(event);
  } catch {
    // Cache diagnostics must never alter provider behavior.
  }
}
