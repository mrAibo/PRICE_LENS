import {bootstrapPriceLens} from "./bootstrap.js";
import {createBuyerDestinationStore} from "./buyer-destination.js";
import {
  createCallbackStorageAdapter,
  sendCallbackRuntimeMessage,
  type CallbackRuntime,
  type CallbackStorageArea
} from "./browser-api.js";
import type {
  CompareMessage,
  CompareResponse,
  PilotAuthResponse
} from "./messages.js";
import type {PilotAuthStatus} from "./pilot-session.js";
import {createComparisonConsentStore} from "./privacy-consent.js";

declare const __PRICE_LENS_GOOGLE_AUTH_ENABLED__: boolean | undefined;

const googleAuthEnabled =
  typeof __PRICE_LENS_GOOGLE_AUTH_ENABLED__ === "boolean" &&
  __PRICE_LENS_GOOGLE_AUTH_ENABLED__;

const runtime: CallbackRuntime = chrome.runtime;
const storage: CallbackStorageArea = chrome.storage.local;

void bootstrapPriceLens({
  document,
  window,
  consentStore: createComparisonConsentStore(
    createCallbackStorageAdapter(storage, runtime)
  ),
  destinationStore: createBuyerDestinationStore(
    createCallbackStorageAdapter(storage, runtime)
  ),
  pilotAuthClient: googleAuthEnabled
    ? {
        getStatus: () =>
          sendPilotAuthMessage({type: "PRICE_LENS_PILOT_AUTH_STATUS"}),
        signIn: () =>
          sendPilotAuthMessage({type: "PRICE_LENS_PILOT_SIGN_IN"}),
        signOut: () =>
          sendPilotAuthMessage({type: "PRICE_LENS_PILOT_SIGN_OUT"})
      }
    : undefined,
  sendMessage(message: CompareMessage): Promise<CompareResponse | undefined> {
    return sendCallbackRuntimeMessage<CompareResponse>(runtime, message);
  }
});


async function sendPilotAuthMessage(
  message:
    | {type: "PRICE_LENS_PILOT_AUTH_STATUS"}
    | {type: "PRICE_LENS_PILOT_SIGN_IN"}
    | {type: "PRICE_LENS_PILOT_SIGN_OUT"}
): Promise<PilotAuthStatus> {
  const response = await sendCallbackRuntimeMessage<PilotAuthResponse>(
    runtime,
    message
  );
  if (!response) {
    throw new Error("No pilot authentication response was returned.");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.status;
}
