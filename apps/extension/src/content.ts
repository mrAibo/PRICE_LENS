import {createPriceLensLifecycle} from "./lifecycle.js";
import type {CompareMessage, CompareResponse} from "./messages.js";

createPriceLensLifecycle({
  document,
  window,
  sendMessage(message: CompareMessage): Promise<CompareResponse | undefined> {
    return chrome.runtime.sendMessage(message) as Promise<CompareResponse | undefined>;
  }
});
