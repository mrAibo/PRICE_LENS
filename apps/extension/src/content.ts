import {bootstrapPriceLens} from "./bootstrap.js";
import type {CompareMessage, CompareResponse} from "./messages.js";
import {createComparisonConsentStore} from "./privacy-consent.js";

void bootstrapPriceLens({
  document,
  window,
  consentStore: createComparisonConsentStore(chrome.storage.local),
  sendMessage(message: CompareMessage): Promise<CompareResponse | undefined> {
    return chrome.runtime.sendMessage(message) as Promise<CompareResponse | undefined>;
  }
});
