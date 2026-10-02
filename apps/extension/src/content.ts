import {bootstrapPriceLens} from "./bootstrap.js";
import {
  createCallbackStorageAdapter,
  sendCallbackRuntimeMessage,
  type CallbackRuntime,
  type CallbackStorageArea
} from "./browser-api.js";
import type {CompareMessage, CompareResponse} from "./messages.js";
import {createComparisonConsentStore} from "./privacy-consent.js";

const runtime: CallbackRuntime = chrome.runtime;
const storage: CallbackStorageArea = chrome.storage.local;

void bootstrapPriceLens({
  document,
  window,
  consentStore: createComparisonConsentStore(
    createCallbackStorageAdapter(storage, runtime)
  ),
  sendMessage(message: CompareMessage): Promise<CompareResponse | undefined> {
    return sendCallbackRuntimeMessage<CompareResponse>(runtime, message);
  }
});
