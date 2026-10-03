import {describe, expect, it} from "vitest";
import {
  BUYER_DESTINATION_KEY,
  createBuyerDestinationStore,
  normalizeBuyerDestination
} from "../src/buyer-destination.js";
import type {StorageAreaLike} from "../src/privacy-consent.js";

function memoryStorage(): {
  storage: StorageAreaLike;
  values: Record<string, unknown>;
} {
  const values: Record<string, unknown> = {};
  return {
    values,
    storage: {
      async get(key) {
        return {[key]: values[key]};
      },
      async set(items) {
        Object.assign(values, items);
      },
      async remove(key) {
        delete values[key];
      }
    }
  };
}

describe("buyer destination", () => {
  it("normalizes supported countries and optional postal codes", () => {
    expect(
      normalizeBuyerDestination({country: "de", postalCode: " 30159 "})
    ).toEqual({country: "DE", postalCode: "30159"});
    expect(normalizeBuyerDestination({country: "PL"})).toEqual({
      country: "PL"
    });
  });

  it("rejects unsupported countries and header-injection characters", () => {
    expect(normalizeBuyerDestination({country: "US"})).toBeUndefined();
    expect(
      normalizeBuyerDestination({
        country: "DE",
        postalCode: "30159,zip=99999"
      })
    ).toBeUndefined();
  });

  it("persists only the normalized destination locally", async () => {
    const {storage, values} = memoryStorage();
    const store = createBuyerDestinationStore(storage);

    await store.setDestination({
      country: "de",
      postalCode: " 30159 "
    });

    expect(values[BUYER_DESTINATION_KEY]).toEqual({
      country: "DE",
      postalCode: "30159"
    });
    await expect(store.getDestination()).resolves.toEqual({
      country: "DE",
      postalCode: "30159"
    });

    await store.clearDestination();
    await expect(store.getDestination()).resolves.toBeUndefined();
  });
});
