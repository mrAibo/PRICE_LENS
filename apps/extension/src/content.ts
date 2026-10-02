import {extractEbayListing} from "./ebay/extract.js";
import type {
  CompareMessage,
  CompareResponse
} from "./messages.js";
import {mountPriceLens} from "./ui/render.js";

const listing = extractEbayListing(document, window.location.href);

if (listing) {
  const view = mountPriceLens(document, listing);
  const message: CompareMessage = {type: "PRICE_LENS_COMPARE", listing};

  void chrome.runtime
    .sendMessage(message)
    .then((response: CompareResponse | undefined) => {
      if (!response) {
        view.renderError("No comparison response was returned.");
        return;
      }

      if (!response.ok) {
        view.renderError(response.error);
        return;
      }

      view.renderComparison(response.result);
    })
    .catch(() => {
      view.renderError("Comparison service is unavailable.");
    });
}
