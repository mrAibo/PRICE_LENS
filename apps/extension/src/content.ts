import type {ComparisonResult} from "@price-lens/contracts";
import {extractEbayListing} from "./ebay/extract.js";
import type {CompareMessage} from "./messages.js";
import {mountPriceLens} from "./ui/render.js";

const listing = extractEbayListing(document, window.location.href);

if (listing) {
  const view = mountPriceLens(document, listing);
  const message: CompareMessage = {type: "PRICE_LENS_COMPARE", listing};

  chrome.runtime.sendMessage(message, (result: ComparisonResult | undefined) => {
    if (chrome.runtime.lastError) {
      view.renderError("Comparison service is unavailable.");
      return;
    }
    if (!result) {
      view.renderError("No comparison result was returned.");
      return;
    }
    view.renderComparison(result);
  });
}
