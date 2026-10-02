import {requestComparison} from "./api/client.js";
import {
  isCompareMessage,
  type CompareResponse
} from "./messages.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCompareMessage(message)) return false;

  void requestComparison(message.listing)
    .then((result) => {
      const response: CompareResponse = {ok: true, result};
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const response: CompareResponse = {
        ok: false,
        error: error instanceof Error ? error.message : "Comparison request failed."
      };
      sendResponse(response);
    });

  return true;
});
