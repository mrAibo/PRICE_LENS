import type {
  BuyerDestination,
  ComparisonResult,
  EcommerceListing
} from "@price-lens/contracts";
import type {PilotAuthStatus} from "./pilot-session.js";

export interface CompareMessage {
  type: "PRICE_LENS_COMPARE";
  listing: EcommerceListing;
  destination?: BuyerDestination;
}

export interface PilotSignInMessage {
  type: "PRICE_LENS_PILOT_SIGN_IN";
}

export interface PilotSignOutMessage {
  type: "PRICE_LENS_PILOT_SIGN_OUT";
}

export interface PilotAuthStatusMessage {
  type: "PRICE_LENS_PILOT_AUTH_STATUS";
}

export type CompareResponse =
  | {ok: true; result: ComparisonResult}
  | {ok: false; error: string};

export type PilotAuthResponse =
  | {ok: true; status: PilotAuthStatus}
  | {ok: false; error: string};

export type PriceLensMessage =
  | CompareMessage
  | PilotSignInMessage
  | PilotSignOutMessage
  | PilotAuthStatusMessage;

export function isCompareMessage(value: unknown): value is CompareMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<CompareMessage>;
  return message.type === "PRICE_LENS_COMPARE" && !!message.listing;
}

export function isPilotSignInMessage(
  value: unknown
): value is PilotSignInMessage {
  return isMessageType(value, "PRICE_LENS_PILOT_SIGN_IN");
}

export function isPilotSignOutMessage(
  value: unknown
): value is PilotSignOutMessage {
  return isMessageType(value, "PRICE_LENS_PILOT_SIGN_OUT");
}

export function isPilotAuthStatusMessage(
  value: unknown
): value is PilotAuthStatusMessage {
  return isMessageType(value, "PRICE_LENS_PILOT_AUTH_STATUS");
}

function isMessageType(
  value: unknown,
  type: PriceLensMessage["type"]
): boolean {
  return !!value && typeof value === "object" && (value as {type?: unknown}).type === type;
}
