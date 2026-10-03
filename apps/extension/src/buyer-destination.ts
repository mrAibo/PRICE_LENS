import type {BuyerDestination} from "@price-lens/contracts";
import type {StorageAreaLike} from "./privacy-consent.js";

export const BUYER_DESTINATION_KEY = "priceLensBuyerDestination.v1";

export const SUPPORTED_BUYER_COUNTRIES = [
  "DE",
  "AT",
  "BE",
  "FR",
  "IT",
  "ES",
  "NL",
  "PL"
] as const;

export type SupportedBuyerCountry = typeof SUPPORTED_BUYER_COUNTRIES[number];

export interface BuyerDestinationStore {
  getDestination(): Promise<BuyerDestination | undefined>;
  setDestination(destination: BuyerDestination): Promise<void>;
  clearDestination(): Promise<void>;
}

export function createBuyerDestinationStore(
  storage: StorageAreaLike
): BuyerDestinationStore {
  return {
    async getDestination() {
      const values = await storage.get(BUYER_DESTINATION_KEY);
      return normalizeBuyerDestination(values[BUYER_DESTINATION_KEY]);
    },
    async setDestination(destination) {
      const normalized = normalizeBuyerDestination(destination);
      if (!normalized) {
        throw new Error("Invalid buyer destination.");
      }
      await storage.set({[BUYER_DESTINATION_KEY]: normalized});
    },
    async clearDestination() {
      await storage.remove(BUYER_DESTINATION_KEY);
    }
  };
}

export function normalizeBuyerDestination(
  value: unknown
): BuyerDestination | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const rawCountry =
    typeof record.country === "string" ? record.country.trim().toUpperCase() : "";
  if (
    !SUPPORTED_BUYER_COUNTRIES.includes(
      rawCountry as SupportedBuyerCountry
    )
  ) {
    return undefined;
  }

  const rawPostal =
    typeof record.postalCode === "string" ? record.postalCode.trim() : "";
  if (!rawPostal) {
    return {country: rawCountry};
  }

  if (
    rawPostal.length > 16 ||
    !/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(rawPostal)
  ) {
    return undefined;
  }

  return {
    country: rawCountry,
    postalCode: rawPostal
  };
}
