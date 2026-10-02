export const COMPARISON_CONSENT_KEY = "priceLensComparisonConsent.v1";

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ComparisonConsentStore {
  hasConsent(): Promise<boolean>;
  grantConsent(): Promise<void>;
  revokeConsent(): Promise<void>;
}

export function createComparisonConsentStore(
  storage: StorageAreaLike
): ComparisonConsentStore {
  return {
    async hasConsent() {
      const values = await storage.get(COMPARISON_CONSENT_KEY);
      return values[COMPARISON_CONSENT_KEY] === true;
    },
    async grantConsent() {
      await storage.set({[COMPARISON_CONSENT_KEY]: true});
    },
    async revokeConsent() {
      await storage.remove(COMPARISON_CONSENT_KEY);
    }
  };
}
