import {describe, expect, it} from "vitest";
import {
  COMPARISON_CONSENT_KEY,
  createComparisonConsentStore,
  type StorageAreaLike
} from "../src/privacy-consent.js";

class MemoryStorage implements StorageAreaLike {
  values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return {[key]: this.values[key]};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(key: string): Promise<void> {
    delete this.values[key];
  }
}

describe("comparison consent store", () => {
  it("defaults to disabled", async () => {
    const storage = new MemoryStorage();
    const store = createComparisonConsentStore(storage);

    await expect(store.hasConsent()).resolves.toBe(false);
  });

  it("persists and revokes explicit consent", async () => {
    const storage = new MemoryStorage();
    const store = createComparisonConsentStore(storage);

    await store.grantConsent();
    expect(storage.values[COMPARISON_CONSENT_KEY]).toBe(true);
    await expect(store.hasConsent()).resolves.toBe(true);

    await store.revokeConsent();
    expect(storage.values).not.toHaveProperty(COMPARISON_CONSENT_KEY);
    await expect(store.hasConsent()).resolves.toBe(false);
  });
});
