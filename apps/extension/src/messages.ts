import type {ComparisonResult, EcommerceListing} from "@price-lens/contracts";

export interface CompareMessage {
  type: "PRICE_LENS_COMPARE";
  listing: EcommerceListing;
}

export type CompareResponse =
  | {ok: true; result: ComparisonResult}
  | {ok: false; error: string};

export type PriceLensMessage = CompareMessage;

export function isCompareMessage(value: unknown): value is CompareMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<CompareMessage>;
  return message.type === "PRICE_LENS_COMPARE" && !!message.listing;
}
