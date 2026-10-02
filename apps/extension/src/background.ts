import {createComparisonShell} from "@price-lens/core";
import {isCompareMessage} from "./messages.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCompareMessage(message)) return false;
  sendResponse(createComparisonShell(message.listing));
  return false;
});
