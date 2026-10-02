import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {
  mountPriceLens,
  mountUnsupportedPriceLens
} from "../src/ui/render.js";

const listing: EcommerceListing = {
  source: "ebay",
  itemId: "123456789012",
  url: "https://www.ebay.de/itm/123456789012",
  title: "Example Product",
  price: {amount: 199, currency: "EUR"},
  shipping: {amount: 0, currency: "EUR"},
  condition: "new",
  identity: {},
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

describe("PriceLens unsupported UI", () => {
  it("renders a labelled unsupported card", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");

    mountUnsupportedPriceLens(
      dom.window.document,
      "This listing cannot be compared safely."
    );

    const host = dom.window.document.getElementById("price-lens-root");
    expect(host).not.toBeNull();
    expect(host?.shadowRoot?.textContent).toContain("Unsupported");
    expect(host?.shadowRoot?.textContent).toContain(
      "This listing cannot be compared safely."
    );
    expect(host?.shadowRoot?.textContent).toContain(
      "No market lookup was sent"
    );
  });

  it("is replaced by the normal card when extraction later succeeds", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");

    mountUnsupportedPriceLens(dom.window.document, "Unsupported");
    mountPriceLens(dom.window.document, listing);

    expect(dom.window.document.querySelectorAll("#price-lens-root")).toHaveLength(1);
    const host = dom.window.document.getElementById("price-lens-root");
    expect(host?.shadowRoot?.textContent).toContain("Example Product");
    expect(host?.shadowRoot?.textContent).not.toContain(
      "No market lookup was sent"
    );
  });
});
