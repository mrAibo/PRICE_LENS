import type {
  ComparisonRequest,
  ComparisonResult,
  EcommerceListing
} from "@price-lens/contracts";
import {isCompareMessage, type CompareResponse} from "./messages.js";

const API_ENDPOINT = "http://127.0.0.1:8787/v1/compare";

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
        error: error instanceof Error
          ? error.message
          : "PriceLens API request failed."
      };
      sendResponse(response);
    });

  return true;
});

async function requestComparison(listing: EcommerceListing): Promise<ComparisonResult> {
  const payload: ComparisonRequest = {listing};
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`PriceLens API returned HTTP ${response.status}.`);
  }

  return (await response.json()) as ComparisonResult;
}
